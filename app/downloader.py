"""Download queue: runs yt-dlp jobs with progress, pause/resume, folders per channel/type."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import yt_dlp
from yt_dlp.postprocessor import PostProcessor
from yt_dlp.utils import sanitize_filename

from .config import ARCHIVE_DIR, JOBS_FILE, PARTIAL_DIR, settings
from .events import bus
from .resolver import classify
from .sites import SITES
from .tools import tools
from .ytdl import YTLogger, base_opts, clean_error

VIDEO_PRESETS = ("best", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144")
AUDIO_PRESETS = ("mp3", "m4a")
SOCIAL_FOLDERS = {"reel": "Reels", "photo": "Photos", "post": "Posts", "story": "Stories", "video": "Videos",
                  "album": "Albums"}
ONLY = ("photos", "videos")  # optional filter for posts that mix photos and videos
VIDEO_EXTS = ("mp4", "webm", "mov", "m4v")
# gallery-dl file names per site (keys missing in a post's metadata render as "None").
GALLERY_FILENAMES = {
    "instagram": "{date:%Y-%m-%d}_{post_shortcode|shortcode}_{num:>02}.{extension}",
    "tiktok": "{date:%Y-%m-%d}_{id}_{num:>02}.{extension}",
    "facebook": "{date:%Y-%m-%d}_{id}.{extension}",
}


def pick_tool(site: str, media_type: str | None, preset: str) -> str:
    """yt-dlp for videos and audio, gallery-dl for photos, carousels and profiles."""
    if site == "youtube" or preset in AUDIO_PRESETS:
        return "ytdlp"
    if site == "instagram" or media_type in ("photo", "story"):
        return "gallery"
    if site == "facebook" and media_type in ("post", "album"):
        return "gallery"  # item by item, see social.part_urls
    return "ytdlp"

ACTIVE = ("queued", "running")
PP_STAGES = {
    "Merger": "Merging video + audio",
    "ExtractAudio": "Converting audio",
    "EmbedThumbnail": "Embedding thumbnail",
    "FFmpegMetadata": "Writing metadata",
    "FFmpegEmbedSubtitle": "Embedding subtitles",
    "FFmpegThumbnailsConvertor": "Preparing thumbnail",
    "MoveFiles": "Finishing",
}


class Cancelled(Exception):
    pass


def safe_name(s: str | None, fallback: str = "Unknown") -> str:
    s = sanitize_filename(str(s or ""), restricted=False).strip().rstrip(". ")
    # Output paths go through os.path.expandvars inside yt-dlp.
    s = s.replace("%", "％").replace("$", "＄")
    return (s or fallback)[:100]


# ---------------------------------------------------------------------------
# Archive of downloaded ids (per kind) so bulk downloads can skip existing ones
# ---------------------------------------------------------------------------

class Archive:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.ids: dict[str, set[str]] = {}
        for kind in ("video", "audio"):
            p = ARCHIVE_DIR / f"{kind}.txt"
            try:
                self.ids[kind] = set(p.read_text("utf-8").split())
            except OSError:
                self.ids[kind] = set()

    def has(self, kind: str, vid: str) -> bool:
        return vid in self.ids[kind]

    def add(self, kind: str, vid: str) -> None:
        with self._lock:
            if vid in self.ids[kind]:
                return
            self.ids[kind].add(vid)
            with open(ARCHIVE_DIR / f"{kind}.txt", "a", encoding="utf-8") as f:
                f.write(vid + "\n")

    def all_ids(self) -> list[str]:
        return sorted(self.ids["video"] | self.ids["audio"])


archive = Archive()


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

PUBLIC_FIELDS = (
    "id", "url", "video_id", "title", "thumb", "channel", "duration", "preset", "kind", "folder", "status",
    "stage", "progress", "downloaded", "total", "speed", "eta", "filepath", "dir", "error", "created",
    "finished", "format_note", "skip_existing", "site", "tool", "files", "media_type", "only",
)


class Job:
    def __init__(self, **kw: Any) -> None:
        self.id: str = kw.get("id") or uuid.uuid4().hex[:12]
        self.url: str = kw["url"]
        self.video_id: str | None = kw.get("video_id")
        self.title: str | None = kw.get("title")
        self.thumb: str | None = kw.get("thumb")
        self.channel: str | None = kw.get("channel")
        self.duration: float | None = kw.get("duration")
        self.preset: str = kw.get("preset") or "1080"
        self.kind: str = "audio" if self.preset in AUDIO_PRESETS else "video"
        self.folder: dict = kw.get("folder") or {"mode": "auto"}
        self.status: str = kw.get("status", "queued")
        self.stage: str | None = kw.get("stage")
        self.progress: float = kw.get("progress", 0.0)
        self.downloaded: int = kw.get("downloaded", 0)
        self.total: int | None = kw.get("total")
        self.speed: float | None = None
        self.eta: int | None = None
        self.filepath: str | None = kw.get("filepath")
        self.dir: str | None = kw.get("dir")
        self.error: str | None = kw.get("error")
        self.created: float = kw.get("created") or time.time()
        self.finished: float | None = kw.get("finished")
        self.format_note: str | None = kw.get("format_note")
        self.skip_existing: bool = kw.get("skip_existing", False)
        self.site: str = kw.get("site") or "youtube"
        self.media_type: str | None = kw.get("media_type")
        self.tool: str = kw.get("tool") or "ytdlp"
        self.files: int = kw.get("files", 0)
        self.only: str | None = kw.get("only") if kw.get("only") in ONLY else None
        self.flag: str | None = None  # "pause" | "cancel" while running
        self.proc: subprocess.Popen | None = None

    def public(self) -> dict:
        return {k: getattr(self, k) for k in PUBLIC_FIELDS}


class _BeforeDownload(PostProcessor):
    """Captures the resolved format selection right before the download starts."""

    def __init__(self, cb) -> None:
        super().__init__(None)
        self._cb = cb

    def run(self, info):
        self._cb(info)
        return [], info


class Downloader:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._lock = threading.RLock()
        self._running: set[str] = set()
        self._save_timer: threading.Timer | None = None
        self._stopping = False
        self.on_downloaded: Callable[[str], None] | None = None
        self._load()

    # -- persistence ------------------------------------------------------
    def _load(self) -> None:
        try:
            data = json.loads(JOBS_FILE.read_text("utf-8"))
        except (OSError, ValueError):
            return
        for d in data:
            try:
                job = Job(**d)
            except KeyError:
                continue
            if job.status == "running":
                job.status, job.stage = "paused", "Interrupted — resume to continue"
            self.jobs[job.id] = job

    def _save_soon(self) -> None:
        with self._lock:
            if self._save_timer:
                self._save_timer.cancel()
            self._save_timer = threading.Timer(1.0, self.save)
            self._save_timer.daemon = True
            self._save_timer.start()

    def save(self) -> None:
        with self._lock:
            data = [j.public() for j in list(self.jobs.values())[-1500:]]
        tmp = JOBS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), "utf-8")
        os.replace(tmp, JOBS_FILE)

    # -- public api ------------------------------------------------------
    def snapshot(self) -> list[dict]:
        with self._lock:
            return [j.public() for j in self.jobs.values()]

    def add(self, items: list[dict], preset: str, folder: dict | None, skip_existing: bool,
            only: str | None = None) -> list[dict]:
        if preset not in VIDEO_PRESETS + AUDIO_PRESETS:
            raise ValueError("Unknown quality preset")
        only = only if only in ONLY else None
        created = []
        with self._lock:
            active_keys = {(j.video_id, j.preset, j.only) for j in self.jobs.values() if j.status in ACTIVE + ("paused",)}
            for it in items:
                c = classify(str(it.get("url") or ""))
                if c["kind"] not in ("video", "media"):
                    continue
                vid = c["video_id"] if c["kind"] == "video" else c["id"]
                if (vid, preset, only) in active_keys:
                    continue  # already in the queue with the same quality
                job_folder = dict(folder or {"mode": "auto"})
                if it.get("index"):
                    job_folder["index"] = int(it["index"])
                site = c.get("site") or "youtube"
                media_type = c.get("media_type") if c["kind"] == "media" else None
                thumb = it.get("thumb") or (f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg" if site == "youtube" else None)
                job = Job(
                    url=c["url"], video_id=vid, title=it.get("title"), thumb=thumb,
                    channel=it.get("channel") or c.get("author"), duration=it.get("duration"), preset=preset,
                    folder=job_folder, skip_existing=skip_existing, site=site, media_type=media_type,
                    tool=pick_tool(site, media_type, preset), only=only if site != "youtube" else None,
                )
                if skip_existing and not job.only and archive.has(job.kind, job.video_id):
                    job.status, job.stage, job.progress, job.finished = "skipped", "Already downloaded", 1.0, time.time()
                self.jobs[job.id] = job
                active_keys.add((job.video_id, preset, job.only))
                created.append(job.public())
        for j in created:
            bus.publish("job", j)
        self._save_soon()
        self.kick()
        return created

    def add_collection(self, site: str, user: str, url: str, label: str, folder: str, thumb: str | None = None,
                       only: str | None = None) -> dict | None:
        """A whole profile tab (e.g. Instagram Reels of @user) downloaded by gallery-dl as one job."""
        if site not in SITES or site == "youtube":
            raise ValueError("Unsupported site")
        key = f"{SITES[site]['prefix']}col:{user}:{folder}"
        with self._lock:
            if any(j.video_id == key and j.status in ACTIVE + ("paused",) for j in self.jobs.values()):
                return None
            job = Job(url=url, video_id=key, title=f"@{user} · {label}", thumb=thumb, channel=user, preset="best",
                      folder={"mode": "collection", "user": user, "folder": folder}, site=site,
                      media_type="collection", tool="gallery", only=only)
            self.jobs[job.id] = job
        bus.publish("job", job.public())
        self._save_soon()
        self.kick()
        return job.public()

    def add_playlist(self, url: str, preset: str, skip_existing: bool, title_hint: str | None = None) -> None:
        """List every video of a playlist/mix (in the background) and queue them all."""
        if preset not in VIDEO_PRESETS + AUDIO_PRESETS:
            raise ValueError("Unknown quality preset")
        from .resolver import listings

        lst = listings.start(url)  # raises ValueError for non-playlist URLs

        def run() -> None:
            deadline = time.time() + 900
            while not lst.done and time.time() < deadline:
                time.sleep(0.4)
            name = lst.meta.get("title") or title_hint or "Playlist"
            if lst.error or not lst.entries:
                bus.toast(f"Couldn't load “{name}”: {lst.error or 'no videos found'}", "error")
                return
            items = [e for e in lst.entries if not e.get("unavailable")]
            folder = {"mode": "playlist", "playlist": name, "channel": lst.meta.get("channel")}
            jobs = self.add(items, preset, folder, skip_existing)
            skipped = sum(1 for j in jobs if j["status"] == "skipped")
            msg = f"Queued {len(jobs) - skipped} videos from “{name}”"
            bus.toast(msg + (f" ({skipped} already downloaded)" if skipped else ""), "success")

        threading.Thread(target=run, daemon=True, name="expand-playlist").start()

    def action(self, job_id: str, action: str) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                raise KeyError(job_id)
            if action in ("pause", "cancel"):
                if job.status == "running":
                    job.flag = action
                    job.stage = "Pausing…" if action == "pause" else "Cancelling…"
                    self._stop_proc(job)
                elif job.status == "queued":
                    job.status = "paused" if action == "pause" else "cancelled"
                    job.stage = None
                    if action == "cancel":
                        self._cleanup_partial(job)
                elif job.status == "paused" and action == "cancel":
                    job.status, job.stage = "cancelled", None
                    self._cleanup_partial(job)
            elif action in ("resume", "retry"):
                if job.status in ("paused", "error", "cancelled", "done", "skipped"):
                    prev = job.status
                    if prev in ("done", "skipped"):
                        job.skip_existing = False
                    if prev != "paused":
                        job.progress, job.downloaded = 0.0, 0
                    job.status, job.error, job.stage, job.flag = "queued", None, None, None
            elif action == "remove":
                if job.status == "running":
                    job.flag = "cancel"
                    self._stop_proc(job)
                self._cleanup_partial(job)
                del self.jobs[job_id]
                bus.publish("job.removed", {"id": job_id})
                self._save_soon()
                return
            else:
                raise ValueError(action)
        self._emit(job, force=True)
        self._save_soon()
        self.kick()

    def batch(self, ids: list[str], action: str) -> int:
        """Apply an action to many selected jobs; each is only touched when the action makes sense for it."""
        allowed = {
            "pause": ("running", "queued"),
            "resume": ("paused", "error", "cancelled"),
            "retry": ("error", "cancelled"),
            "remove": None,
        }
        if action not in allowed:
            raise ValueError(action)
        done = 0
        for i in ids:
            job = self.jobs.get(i)
            if not job or (allowed[action] and job.status not in allowed[action]):
                continue
            self.action(i, action)
            done += 1
        return done

    def bulk(self, action: str) -> None:
        with self._lock:
            ids = list(self.jobs)
        if action == "pause_all":
            for i in ids:
                if self.jobs.get(i) and self.jobs[i].status in ACTIVE:
                    self.action(i, "pause")
        elif action == "resume_all":
            for i in ids:
                if self.jobs.get(i) and self.jobs[i].status == "paused":
                    self.action(i, "resume")
        elif action == "retry_failed":
            for i in ids:
                if self.jobs.get(i) and self.jobs[i].status == "error":
                    self.action(i, "retry")
        elif action == "clear_finished":
            with self._lock:
                for i in ids:
                    if self.jobs[i].status in ("done", "skipped", "cancelled"):
                        del self.jobs[i]
                        bus.publish("job.removed", {"id": i})
            self._save_soon()

    def shutdown(self) -> None:
        self._stopping = True
        with self._lock:
            for job in self.jobs.values():
                if job.status == "running":
                    job.flag = "pause"
        deadline = time.time() + 5
        while self._running and time.time() < deadline:
            time.sleep(0.1)
        with self._lock:
            for job in self.jobs.values():
                if job.status == "running":
                    job.status, job.stage = "paused", "Interrupted — resume to continue"
        self.save()

    # -- scheduling ------------------------------------------------------
    def kick(self) -> None:
        if self._stopping:
            return
        with self._lock:
            limit = int(settings["concurrency"])
            for job in self.jobs.values():
                if len(self._running) >= limit:
                    break
                if job.status == "queued" and job.id not in self._running:
                    job.status, job.stage, job.flag = "running", "Starting…", None
                    self._running.add(job.id)
                    target = (self._run_gallery if job.tool == "gallery" else
                              self._run_direct if job.tool == "direct" else self._run)
                    threading.Thread(target=target, args=(job,), daemon=True, name=f"dl-{job.id}").start()

    def _run_gallery(self, job: Job) -> None:
        tools.ready.wait(timeout=600)
        _run_gallery_impl(self, job)

    def _run_direct(self, job: Job) -> None:
        tools.ready.wait(timeout=600)
        _run_direct_impl(self, job)

    @staticmethod
    def _stop_proc(job: Job) -> None:
        proc = job.proc
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass

    def _emit(self, job: Job, force: bool = False) -> None:
        bus.publish("job", job.public(), throttle_key=None if force else f"job-{job.id}", interval=0.3)

    # -- execution -------------------------------------------------------
    def _cleanup_partial(self, job: Job) -> None:
        shutil.rmtree(PARTIAL_DIR / job.id, ignore_errors=True)

    def _target_dir(self, job: Job, info: dict) -> Path:
        root = Path(settings["download_dir"])
        f = job.folder or {}
        mode = f.get("mode", "auto")
        if job.site != "youtube":
            base = root / SITES[job.site]["label"]
            if mode == "collection":
                return base / safe_name(f.get("user")) / safe_name(f.get("folder"), "Posts")
            author = job.channel or info.get("channel") or info.get("uploader") or info.get("uploader_id")
            return base / safe_name(author, "Unknown") / SOCIAL_FOLDERS.get(job.media_type or "video", "Videos")
        channel = safe_name(f.get("channel") or info.get("channel") or info.get("uploader"), "Unknown channel")
        if mode == "channel_tab":
            return root / channel / safe_name(f.get("tab_folder"), "Videos")
        if mode == "playlist":
            pl = safe_name(f.get("playlist"), "Playlist")
            owner = f.get("channel")
            return root / safe_name(owner) / "Playlists" / pl if owner else root / "Playlists" / pl
        if mode == "flat" or not settings["organize_by_channel"]:
            return root
        if "/shorts/" in job.url or _looks_vertical_short(info):
            sub = "Shorts"
        elif info.get("live_status") in ("was_live", "post_live"):
            sub = "Live"
        else:
            sub = "Videos"
        return root / channel / sub

    def _ytdl_args(self, job: Job) -> list[str]:
        s = settings
        args: list[str] = ["--no-mtime", "--concurrent-fragments", "4", "--no-playlist"]
        if job.kind == "audio":
            if job.preset == "mp3":
                args += ["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", f"{s['audio_quality']}K"]
            else:
                args += ["-f", "ba[ext=m4a]/ba/b", "-x", "--audio-format", "m4a"]
        else:
            if job.preset == "best":
                fmt = "bv*+ba/b"
            else:
                h = int(job.preset)
                fmt = f"bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b"
            args += ["-f", fmt, "--merge-output-format", s["container"]]
            if s["prefer_compatible"]:
                args += ["-S", "res,fps,vcodec:h264,acodec:m4a"]
            if s["embed_chapters"]:
                args += ["--embed-chapters"]
            if s["embed_subs"]:
                args += ["--embed-subs", "--sub-langs", s["sub_langs"]]
        if s["embed_thumbnail"]:
            args += ["--embed-thumbnail", "--convert-thumbnails", "jpg"]
        if s["embed_metadata"]:
            args += ["--embed-metadata"]
        return args

    def _run(self, job: Job) -> None:
        tools.ready.wait(timeout=600)
        log = YTLogger()
        parts: dict[str, list[int]] = {}
        expected: dict[str, int] = {"total": 0}

        def check_flag() -> None:
            if job.flag:
                raise Cancelled(job.flag)

        def on_progress(d: dict) -> None:
            check_flag()
            fn = d.get("filename") or d.get("tmpfilename") or "?"
            if d.get("status") == "downloading":
                dl = int(d.get("downloaded_bytes") or 0)
                tot = int(d.get("total_bytes") or d.get("total_bytes_estimate") or 0)
                parts[fn] = [dl, tot]
                done = sum(p[0] for p in parts.values())
                total = max(expected["total"], sum(p[1] for p in parts.values()))
                job.downloaded, job.total = done, total or None
                job.progress = min(done / total, 0.995) if total else job.progress
                job.speed, job.eta = d.get("speed"), d.get("eta")
                info = d.get("info_dict") or {}
                is_audio_part = info.get("vcodec") == "none" and job.kind == "video"
                job.stage = "Downloading audio" if is_audio_part else "Downloading"
                self._emit(job)
            elif d.get("status") == "finished":
                p = parts.setdefault(fn, [0, 0])
                p[0] = p[1] = max(p[0], p[1], int(d.get("total_bytes") or d.get("downloaded_bytes") or 0))

        def on_pp(d: dict) -> None:
            if d.get("status") == "started":
                label = PP_STAGES.get(d.get("postprocessor") or "")
                if label:
                    job.stage, job.speed, job.eta = label, None, None
                    self._emit(job, force=True)

        def before_dl(info: dict) -> None:
            req = info.get("requested_formats") or [info]
            expected["total"] = sum(int(f.get("filesize") or f.get("filesize_approx") or 0) for f in req)
            h = info.get("height")
            if job.kind == "video" and h:
                vcodec = str(info.get("vcodec") or "").split(".")[0]
                job.format_note = f"{h}p{int(info['fps']) if (info.get('fps') or 0) > 30 else ''} · {vcodec}"
            elif job.kind == "audio":
                job.format_note = job.preset.upper()

        try:
            job.stage = "Fetching video info"
            self._emit(job, force=True)
            opts = yt_dlp.parse_options(self._ytdl_args(job)).ydl_opts
            opts.update(base_opts(log, site=job.site))
            opts.update({
                "outtmpl": {"default": "%(title).180B.%(ext)s"},
                "progress_hooks": [on_progress],
                "postprocessor_hooks": [on_pp],
            })
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(job.url, download=False, process=False)
                for _ in range(3):  # e.g. Facebook reels hand over to the /watch page
                    if info.get("_type") not in ("url", "url_transparent") or not info.get("url"):
                        break
                    info = ydl.extract_info(info["url"], download=False, process=False)
                check_flag()
                live = info.get("live_status")
                if live == "is_live":
                    raise RuntimeError("This stream is live right now. Download it after it ends.")
                if live == "is_upcoming":
                    raise RuntimeError("This stream hasn't started yet.")
                job.title = info.get("title") or job.title
                job.channel = info.get("channel") or info.get("uploader") or job.channel
                job.duration = info.get("duration") or job.duration
                target = self._target_dir(job, info)
                target.mkdir(parents=True, exist_ok=True)
                job.dir = str(target)
                idx = (job.folder or {}).get("index")
                name = f"{int(idx):03d} - %(title).170B.%(ext)s" if idx else "%(title).180B.%(ext)s"
                if job.site != "youtube":
                    name = "%(title).80B [%(id)s].%(ext)s"
                ydl.params["outtmpl"] = {"default": name}
                ydl.params["paths"] = {"home": str(target), "temp": str(PARTIAL_DIR / job.id)}
                ydl.add_post_processor(_BeforeDownload(before_dl), when="before_dl")
                job.stage = "Starting download"
                self._emit(job, force=True)
                res = ydl.process_ie_result(info, download=True)
            if log.errors and not res:
                raise RuntimeError(log.errors[-1])
            downloads = (res or {}).get("requested_downloads") or []
            job.filepath = (downloads[-1].get("filepath") if downloads else None) or (res or {}).get("filepath")
            if job.flag == "cancel":
                if job.filepath and os.path.exists(job.filepath):
                    os.remove(job.filepath)
                raise Cancelled("cancel")
            job.status, job.stage, job.progress = "done", None, 1.0
            job.speed = job.eta = None
            job.finished = time.time()
            if job.filepath and os.path.exists(job.filepath):
                job.total = job.downloaded = os.path.getsize(job.filepath)
            archive.add(job.kind, job.video_id)
            bus.publish("downloaded", {"id": job.video_id})
            if self.on_downloaded:
                self.on_downloaded(job.video_id)
            self._cleanup_partial(job)
        except BaseException as e:  # noqa: BLE001 - yt-dlp wraps our Cancelled in its own exceptions
            job.speed = job.eta = None
            if job.flag == "pause":
                job.status, job.stage = "paused", "Paused"
            elif job.flag == "cancel":
                job.status, job.stage = "cancelled", None
                self._cleanup_partial(job)
            elif job.site != "youtube" and job.kind != "audio" and job.tool == "ytdlp":
                # yt-dlp can't do photo posts / carousels: retry with gallery-dl.
                job.tool, job.status, job.stage, job.error = "gallery", "queued", "Trying the photo downloader…", None
            else:
                job.status, job.stage = "error", None
                job.error = clean_error(log.errors[-1] if log.errors else e)
        finally:
            job.flag = None
            with self._lock:
                self._running.discard(job.id)
            if job.id in self.jobs:
                self._emit(job, force=True)
                if job.status == "done" and not any(j.status in ACTIVE for j in self.jobs.values()):
                    bus.publish("queue.idle", {})
            self._save_soon()
            self.kick()


def _gallery_cmd(job: Job, target: Path, cookies: str | None, urls: list[str] | None = None) -> list[str]:
    cmd = [sys.executable, "-m", "gallery_dl", "-D", str(target),
           "--download-archive", str(ARCHIVE_DIR / f"gallery-{job.site}.sqlite3"),
           "-o", "output.progress=false", "-o", "output.shorten=false"]
    if job.site in GALLERY_FILENAMES:
        cmd += ["-f", GALLERY_FILENAMES[job.site]]
    if job.site == "facebook":
        cmd += ["-o", "extractor.facebook.videos=ytdl"]  # merged video + audio instead of two files
    # Videos gallery-dl hands to yt-dlp: same container and codec preference as the app's own downloads.
    raw: dict[str, Any] = {"merge_output_format": settings["container"]}
    if settings["prefer_compatible"]:
        raw["format_sort"] = ["res", "fps", "vcodec:h264", "acodec:m4a"]
    cmd += ["-o", "downloader.ytdl.raw-options=" + json.dumps(raw)]
    if job.only and urls is None:
        exts = repr(VIDEO_EXTS)
        cmd += ["--filter", f"extension {'in' if job.only == 'videos' else 'not in'} {exts}"]
    if cookies:
        cmd += ["--cookies", cookies]
    return cmd + (urls or [job.url])


def _signed_out(text: str) -> bool:
    low = text.lower()
    return "login" in low or "401" in low or "cookies" in low or "authenticat" in low or "signed in" in low


_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
       "Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0")


def _fetch(job: Job, url: str, dest: Path) -> Path:
    """Stream `url` to `dest` (extension fixed from the content), honouring pause / cancel."""
    import urllib.request

    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Referer": f"https://www.{job.site}.com/"})
    tmp = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, "wb") as out:
        while chunk := resp.read(1 << 16):
            if job.flag:
                raise Cancelled(job.flag)
            out.write(chunk)
            job.downloaded += len(chunk)
    final = dest.with_name(dest.name + ".bin")
    os.replace(tmp, final)
    return Path(_fix_extension(str(final)))


def _probe(path: Path) -> dict:
    ffmpeg = tools.path("ffmpeg")
    probe = str(Path(ffmpeg).with_name("ffprobe" + Path(ffmpeg).suffix)) if ffmpeg else "ffprobe"
    out = subprocess.run([probe, "-v", "error", "-show_entries", "stream=codec_type,height", "-of", "json", str(path)],
                         capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        streams = json.loads(out.stdout or "{}").get("streams") or []
    except ValueError:
        streams = []
    return {"video": max((int(st.get("height") or 1) for st in streams if st.get("codec_type") == "video"), default=0),
            "audio": any(st.get("codec_type") == "audio" for st in streams)}


def _save_streams(job: Job, item: dict, work: Path, dest: Path) -> Path:
    """Video players stream picture and sound separately: fetch the candidates, keep the sharpest picture
    and the sound, and merge them into one file."""
    files = []
    for k, u in enumerate((item.get("streams") or []) + (item.get("audio") or [])):
        try:
            f = _fetch(job, u, work / f"s{k}")
            files.append((f, _probe(f)))
        except Cancelled:
            raise
        except Exception:
            continue
    video = max((x for x in files if x[1]["video"]), key=lambda x: (x[1]["video"], x[0].stat().st_size), default=None)
    if not video:
        raise RuntimeError("Couldn't save this video.")
    out = dest.with_name(dest.name + ".mp4")
    if video[1]["audio"]:
        shutil.move(str(video[0]), out)
        return out
    audio = max((x for x in files if x[1]["audio"] and not x[1]["video"]), key=lambda x: x[0].stat().st_size, default=None)
    if not audio:
        shutil.move(str(video[0]), out)
        return out
    ffmpeg = tools.path("ffmpeg") or "ffmpeg"
    res = subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(video[0]), "-i", str(audio[0]), "-map", "0:v:0", "-map", "1:a:0",
                          "-c", "copy", "-movflags", "+faststart", str(out)],
                         capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if res.returncode != 0:
        raise RuntimeError("Couldn't merge the video and its sound.")
    return out


def _run_direct_impl(self: "Downloader", job: Job) -> None:
    """Save what the logged-in browser shows for the post (see social.browser_media)."""
    work = PARTIAL_DIR / job.id
    try:
        from .social import browser_media

        job.stage, job.files, job.downloaded = "Opening the post in the browser…", 0, 0
        self._emit(job, force=True)
        info = browser_media(job.url)
        items = [i for i in info["direct"] if not job.only or (job.only == "videos") == (i["type"] == "video")]
        if not items:
            raise RuntimeError(f"No {job.only or 'photos or videos'} found on this page.")
        job.title = job.title or info.get("title")
        job.thumb = job.thumb or info.get("thumb")
        target = self._target_dir(job, {})
        target.mkdir(parents=True, exist_ok=True)
        job.dir = str(target)
        work.mkdir(parents=True, exist_ok=True)
        base = safe_name((job.video_id or "post").split(":")[-1], "post")
        for n, item in enumerate(items, 1):
            if job.flag:
                raise Cancelled(job.flag)
            job.stage = f"Saving {n} of {len(items)}"
            self._emit(job, force=True)
            dest = target / f"{base}_{n:02}"
            if item.get("url"):
                path = _fetch(job, item["url"], dest)
            else:
                path = _save_streams(job, item, work, dest)
            job.files += 1
            job.filepath = str(path)
            self._emit(job)
        job.status, job.stage, job.progress, job.finished = "done", None, 1.0, time.time()
        job.total = job.downloaded or None
        archive.add(job.kind, job.video_id)
        bus.publish("downloaded", {"id": job.video_id})
        if self.on_downloaded:
            self.on_downloaded(job.video_id)
    except BaseException as e:  # noqa: BLE001
        if job.flag == "pause":
            job.status, job.stage = "paused", "Paused"
        elif job.flag == "cancel":
            job.status, job.stage = "cancelled", None
        else:
            job.status, job.stage = "error", None
            job.error = clean_error(str(e))
    finally:
        shutil.rmtree(work, ignore_errors=True)
        job.flag = None
        with self._lock:
            self._running.discard(job.id)
        if job.id in self.jobs:
            self._emit(job, force=True)
        self._save_soon()
        self.kick()


def _sniff(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG"):
        return "png"
    if head.startswith(b"GIF8"):
        return "gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"heic", b"heix", b"mif1", b"msf1"):
            return "heic"
        if brand in (b"avif", b"avis"):
            return "avif"
        return "mp4"
    return None


def _fix_extension(path: str) -> str:
    """Instagram serves JPEGs under .heic / .webp names; give the file the extension of what it really is."""
    p = Path(path)
    try:
        with open(p, "rb") as f:
            real = _sniff(f.read(16))
    except OSError:
        return path
    ext = p.suffix.lower().lstrip(".")
    if not real or ext == real or (real == "jpg" and ext == "jpeg") or (real == "mp4" and ext in ("m4v", "mov")):
        return path
    new = p.with_suffix("." + real)
    if new.exists():
        return path
    try:
        p.rename(new)
    except OSError:
        return path
    return str(new)


def _run_gallery_impl(self: "Downloader", job: Job) -> None:
    from . import ytdl

    stderr: list[str] = []
    cookies: str | None = None
    try:
        job.stage, job.files, job.downloaded = "Starting", 0, 0
        self._emit(job, force=True)
        urls: list[str] | None = None
        from .social import is_composite, part_urls

        if is_composite(job.site, job.media_type):
            job.stage = "Reading post…"
            self._emit(job, force=True)
            urls, info = part_urls(job.url, job.only)
            job.title = job.title or info.get("title")
            job.channel = info.get("author") or job.channel  # the name Facebook shows, not the URL slug
            job.thumb = job.thumb or info.get("thumb")
            if not urls:
                raise RuntimeError(f"No {job.only or 'photos or videos'} in this post.")
        elif job.media_type != "collection" and (not job.channel or not job.title):
            # Queued from a link alone (selection, right-click): the post's metadata names its author.
            job.stage = "Reading post…"
            self._emit(job, force=True)
            try:
                from .social import media_info

                info = media_info(job.url)
                job.channel = job.channel or info.get("author")
                job.title = job.title or info.get("title")
                job.thumb = job.thumb or info.get("thumb")
            except Exception:
                pass
        cookies = ytdl.social_cookies(job.site)
        target = self._target_dir(job, {})
        target.mkdir(parents=True, exist_ok=True)
        job.dir = str(target)
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        ffmpeg = tools.path("ffmpeg")
        if ffmpeg:
            env["PATH"] = os.path.dirname(ffmpeg) + os.pathsep + env.get("PATH", "")
        proc = subprocess.Popen(_gallery_cmd(job, target, cookies, urls), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace", env=env,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        job.proc = proc

        def read_err() -> None:
            for line in proc.stderr:  # type: ignore[union-attr]
                stderr.append(line.strip())

        threading.Thread(target=read_err, daemon=True).start()
        skipped = 0
        for line in proc.stdout:  # type: ignore[union-attr]
            line = line.strip()
            if not line:
                continue
            if line.startswith("# "):
                skipped += 1  # already in gallery-dl's archive or on disk
                path = line[2:]
            else:
                job.files += 1
                path = _fix_extension(line)
                if os.path.exists(path):
                    job.downloaded += os.path.getsize(path)
            job.filepath = path
            done = job.files + skipped
            job.stage = f"{done} file{'s' if done != 1 else ''}" + (f" ({skipped} already saved)" if skipped else "")
            self._emit(job)
        code = proc.wait()
        if job.flag:
            raise Cancelled(job.flag)
        if code != 0 and job.files + skipped == 0:
            errs = [ln for ln in stderr if "error" in ln.lower()] or stderr
            msg = errs[-1] if errs else f"gallery-dl exited with code {code}"
            raise RuntimeError(msg.split("] ", 1)[-1])
        if job.files + skipped == 0 and not job.only and job.media_type != "collection":
            raise RuntimeError("No media found")  # a post always has some: the page format probably changed
        job.status, job.progress, job.finished = "done", 1.0, time.time()
        job.stage = None if job.files else ("Everything was already saved" if skipped else "No media found")
        job.total = job.downloaded or None
        if job.media_type != "collection" and job.video_id:
            archive.add(job.kind, job.video_id)
            bus.publish("downloaded", {"id": job.video_id})
            if self.on_downloaded:
                self.on_downloaded(job.video_id)
    except BaseException as e:  # noqa: BLE001
        if job.flag == "pause":
            job.status, job.stage = "paused", "Paused"
        elif job.flag == "cancel":
            job.status, job.stage = "cancelled", None
        elif job.media_type != "collection" and job.kind != "audio" and not _signed_out(str(e))                 and type(e).__name__ != "NoMedia":
            # The downloaders couldn't read this page (sites change often): take what the browser shows.
            job.tool, job.status, job.stage, job.error = "direct", "queued", "Trying the browser…", None
        else:
            job.status, job.stage = "error", None
            text = str(e)
            low = text.lower()
            if _signed_out(text):
                label = SITES[job.site]["label"]
                text = f"{label} needs you to be signed in. Sign in on the {label} tab and retry."
            job.error = clean_error(text)
    finally:
        ytdl.drop_copy(cookies)
        job.proc = None
        job.flag = None
        with self._lock:
            self._running.discard(job.id)
        if job.id in self.jobs:
            self._emit(job, force=True)
        self._save_soon()
        self.kick()


def _looks_vertical_short(info: dict) -> bool:
    dur = info.get("duration") or 0
    if not dur or dur > 180:
        return False
    fmts = [f for f in info.get("formats") or [] if f.get("width") and f.get("height")]
    if not fmts:
        return False
    f = max(fmts, key=lambda f: f["height"])
    return f["height"] > f["width"]


def open_path(path: str, reveal: bool = False) -> None:
    if reveal:
        if os.path.isfile(path):
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        else:
            os.startfile(os.path.normpath(path))  # type: ignore[attr-defined]
    else:
        os.startfile(os.path.normpath(path))  # type: ignore[attr-defined]


downloader = Downloader()
