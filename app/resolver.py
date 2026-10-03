"""Understand YouTube URLs and list videos of channels / playlists incrementally."""
from __future__ import annotations

import re
import threading
import time
from typing import Any, Iterable
from urllib.parse import parse_qs, urlparse

import yt_dlp

from .events import bus
from .ytdl import YTLogger, base_opts, clean_error

YT_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
    "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
PLAYLIST_ID = re.compile(r"^[A-Za-z0-9_-]{2,64}$")
CHANNEL_PATH = re.compile(r"^/(@[^/]+|channel/UC[A-Za-z0-9_-]{22}|c/[^/]+|user/[^/]+)(?:/([^/?#]+))?")

# Channel tabs we let users download, in display order: key -> (url suffix, label, folder name)
CHANNEL_TABS = {
    "videos": ("videos", "Videos", "Videos"),
    "shorts": ("shorts", "Shorts", "Shorts"),
    "streams": ("streams", "Live", "Live"),
}
_TAB_BY_LABEL = {"Videos": "videos", "Shorts": "shorts", "Live": "streams"}


def is_youtube(url: str) -> bool:
    try:
        return (urlparse(url).hostname or "").lower() in YT_HOSTS
    except ValueError:
        return False


def classify(url: str) -> dict[str, Any]:
    """Pure URL analysis, no network. Used for the browse pane context and the paste box."""
    c = _classify(url)
    c.setdefault("site", "youtube" if c["kind"] != "invalid" else None)
    return c


def _classify(url: str) -> dict[str, Any]:
    url = (url or "").strip()
    if url and "://" not in url:
        url = "https://" + url
    try:
        u = urlparse(url)
    except ValueError:
        return {"kind": "invalid", "url": url}
    host = (u.hostname or "").lower()
    if host not in YT_HOSTS:
        from .sites import classify_social

        return classify_social(url)
    q = parse_qs(u.query)
    path = u.path or "/"
    list_id = (q.get("list") or [None])[0]
    if list_id and not PLAYLIST_ID.match(list_id):
        list_id = None

    video_id = None
    short = False
    if host.endswith("youtu.be"):
        video_id = path.strip("/").split("/")[0]
    elif path == "/watch":
        video_id = (q.get("v") or [None])[0]
    else:
        m = re.match(r"^/(shorts|live|embed|v)/([A-Za-z0-9_-]{11})", path)
        if m:
            video_id, short = m.group(2), m.group(1) == "shorts"

    if video_id and VIDEO_ID.match(video_id):
        return {
            "kind": "video",
            "url": f"https://www.youtube.com/{'shorts/' if short else 'watch?v='}{video_id}",
            "video_id": video_id,
            "short": short,
            "playlist_id": list_id,
            "playlist_url": playlist_url(list_id, video_id) if list_id else None,
        }
    if path == "/playlist" and list_id:
        return {"kind": "playlist", "url": playlist_url(list_id), "playlist_id": list_id}

    m = CHANNEL_PATH.match(path)
    if m:
        base = f"https://www.youtube.com/{m.group(1)}"
        tab = m.group(2)
        return {"kind": "channel", "url": base, "channel_url": base, "tab": tab if tab in CHANNEL_TABS else None}

    page = "home" if path in ("/", "") else "search" if path == "/results" else "feed" if path.startswith("/feed") else "other"
    return {"kind": "page", "page": page, "url": url}


def playlist_url(list_id: str, video_id: str | None = None) -> str:
    # Mixes ("RD...") only exist in the context of a video.
    if list_id.startswith("RD") and video_id:
        return f"https://www.youtube.com/watch?v={video_id}&list={list_id}"
    return f"https://www.youtube.com/playlist?list={list_id}"


# ---------------------------------------------------------------------------
# Entry normalisation
# ---------------------------------------------------------------------------

def _pick_thumb(thumbs: Iterable[dict] | None, vid: str, short: bool) -> str:
    if not short:
        return f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"
    best = None
    for t in thumbs or []:
        w = t.get("width") or 0
        if t.get("url") and (best is None or abs(w - 300) < abs((best.get("width") or 0) - 300)):
            best = t
    return best["url"] if best else f"https://i.ytimg.com/vi/{vid}/oar2.jpg"


def norm_entry(e: dict) -> dict | None:
    vid = e.get("id")
    if not vid or not VIDEO_ID.match(str(vid)):
        return None
    url = e.get("url") or f"https://www.youtube.com/watch?v={vid}"
    short = "/shorts/" in url
    title = e.get("title") or vid
    live = e.get("live_status")
    unavailable = None
    if title in ("[Private video]", "[Deleted video]"):
        unavailable = title.strip("[]")
    elif live in ("is_upcoming",):
        unavailable = "Upcoming"
    elif live in ("is_live",):
        unavailable = "Live now"
    return {
        "id": vid,
        "url": url if url.startswith("http") else f"https://www.youtube.com/watch?v={vid}",
        "title": title,
        "duration": e.get("duration"),
        "views": e.get("view_count"),
        "thumb": _pick_thumb(e.get("thumbnails"), vid, short),
        "short": short,
        "channel": e.get("channel") or e.get("uploader"),
        "unavailable": unavailable,
    }


def _avatar(thumbs: list[dict] | None) -> str | None:
    for t in thumbs or []:
        if t.get("id") in ("avatar_uncropped",):
            return t.get("url")
    square = [t for t in thumbs or [] if t.get("width") and t.get("width") == t.get("height")]
    return (square[-1] if square else {}).get("url")


def _resolve_redirects(ydl: yt_dlp.YoutubeDL, url: str) -> dict:
    info = ydl.extract_info(url, download=False, process=False)
    for _ in range(3):
        if info.get("_type") in ("url", "url_transparent") and info.get("url"):
            info = ydl.extract_info(info["url"], download=False, process=False)
        else:
            break
    return info


# ---------------------------------------------------------------------------
# Channel metadata
# ---------------------------------------------------------------------------

_channel_cache: dict[str, tuple[float, dict]] = {}


def channel_info(url: str) -> dict:
    base = classify(url).get("channel_url") or url
    cached = _channel_cache.get(base)
    if cached and time.time() - cached[0] < 900:
        return cached[1]
    opts = base_opts() | {"extract_flat": "in_playlist", "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(base, download=False, process=False)
    tabs: list[str] = []
    entries = info.get("entries")
    if isinstance(entries, list):
        for e in entries:
            label = str(e.get("title") or "").rsplit(" - ", 1)[-1]
            if label in _TAB_BY_LABEL:
                tabs.append(_TAB_BY_LABEL[label])
    if not tabs:
        tabs = list(CHANNEL_TABS)
    channel_id = info.get("channel_id") or info.get("id")
    result = {
        "title": info.get("channel") or info.get("title") or "Channel",
        "channel_id": channel_id,
        "handle": info.get("uploader_id"),
        "url": f"https://www.youtube.com/channel/{channel_id}" if channel_id else base,
        "avatar": _avatar(info.get("thumbnails")),
        "followers": info.get("channel_follower_count"),
        "description": (info.get("description") or "")[:280],
        "tabs": [{"key": k, "label": CHANNEL_TABS[k][1]} for k in CHANNEL_TABS if k in tabs],
    }
    _channel_cache[base] = (time.time(), result)
    return result


# ---------------------------------------------------------------------------
# Incremental listings (channel tabs + playlists)
# ---------------------------------------------------------------------------

class Listing:
    def __init__(self, key: str, url: str, kind: str) -> None:
        self.key = key
        self.url = url
        self.kind = kind
        self.meta: dict[str, Any] = {}
        self.entries: list[dict] = []
        self.done = False
        self.error: str | None = None
        self.created = time.time()
        self.cancelled = False
        self._sent = 0

    def snapshot(self) -> dict:
        return {"key": self.key, "kind": self.kind, "meta": self.meta, "entries": self.entries,
                "count": len(self.entries), "done": self.done, "error": self.error}

    def emit(self, force: bool = False) -> None:
        if not force and len(self.entries) - self._sent < 30 and not self.done:
            return
        added = self.entries[self._sent:]
        self._sent = len(self.entries)
        bus.publish("listing", {"key": self.key, "meta": self.meta, "added": added, "count": len(self.entries),
                                "done": self.done, "error": self.error})


class Listings:
    TTL = 900

    def __init__(self) -> None:
        self._items: dict[str, Listing] = {}
        self._lock = threading.Lock()
        self._sem = threading.Semaphore(4)

    def get(self, key: str) -> Listing | None:
        return self._items.get(key)

    def start(self, url: str, tab: str | None = None, refresh: bool = False) -> Listing:
        c = classify(url)
        if c["kind"] == "channel":
            tab = tab or c.get("tab") or "videos"
            if tab not in CHANNEL_TABS:
                raise ValueError("Unsupported channel tab")
            target = f"{c['channel_url']}/{CHANNEL_TABS[tab][0]}"
            key, kind = f"channel:{c['channel_url'].lower()}:{tab}", "channel_tab"
        elif c.get("playlist_id"):
            target = c["playlist_url"] if c["kind"] == "video" else c["url"]
            key, kind = f"playlist:{c['playlist_id']}", "playlist"
        else:
            raise ValueError("Not a channel or playlist URL")

        with self._lock:
            existing = self._items.get(key)
            fresh = existing and (not existing.error) and time.time() - existing.created < self.TTL
            if existing and fresh and not refresh:
                return existing
            if existing:
                existing.cancelled = True
            lst = Listing(key, target, kind)
            if kind == "channel_tab":
                lst.meta = {"tab": tab, "label": CHANNEL_TABS[tab][1], "folder": CHANNEL_TABS[tab][2]}
            self._items[key] = lst
        threading.Thread(target=self._run, args=(lst,), daemon=True, name=f"list-{key}").start()
        return lst

    def _run(self, lst: Listing) -> None:
        with self._sem:
            opts = base_opts() | {"extract_flat": "in_playlist", "skip_download": True, "noplaylist": False}
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = _resolve_redirects(ydl, lst.url)
                    lst.meta.update({
                        "title": info.get("title"),
                        "channel": info.get("channel") or info.get("uploader"),
                        "channel_url": info.get("channel_url") or info.get("uploader_url"),
                        "expected": info.get("playlist_count"),
                    })
                    lst.emit(force=True)
                    seen: set[str] = set()
                    is_mix = lst.key.startswith("playlist:RD")
                    if is_mix:
                        lst.meta["mix"] = True
                        lst.meta["expected"] = MIX_LIMIT
                    for e in info.get("entries") or []:
                        if lst.cancelled:
                            return
                        if is_mix and len(lst.entries) >= MIX_LIMIT:
                            break
                        n = norm_entry(e or {})
                        if n and n["id"] not in seen:
                            seen.add(n["id"])
                            n["index"] = len(lst.entries) + 1
                            lst.entries.append(n)
                            lst.emit()
            except Exception as e:
                msg = clean_error(e)
                # A channel without e.g. a Live tab is not an error for the UI, just empty.
                if "does not have a" in msg and "tab" in msg:
                    lst.meta["missing"] = True
                else:
                    lst.error = msg
            finally:
                lst.done = True
                lst.emit(force=True)


listings = Listings()


# ---------------------------------------------------------------------------
# Single video details (formats + size estimates)
# ---------------------------------------------------------------------------

_video_cache: dict[str, tuple[float, dict]] = {}
# YouTube mixes ("RD..." lists) are generated endlessly by yt-dlp; YouTube itself shows about this many.
MIX_LIMIT = 50

HEIGHTS = (4320, 2160, 1440, 1080, 720, 480, 360, 240, 144)


def _size(f: dict) -> int | None:
    return f.get("filesize") or f.get("filesize_approx")


def video_info(url: str) -> dict:
    c = classify(url)
    if c["kind"] != "video":
        raise ValueError("Not a video URL")
    vid = c["video_id"]
    cached = _video_cache.get(vid)
    if cached and time.time() - cached[0] < 600:
        return cached[1]
    log = YTLogger()
    with yt_dlp.YoutubeDL(base_opts(log) | {"skip_download": True}) as ydl:
        info = ydl.extract_info(c["url"], download=False, process=False)
    formats = info.get("formats") or []
    audio = [f for f in formats if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")]
    best_audio = max(audio, key=lambda f: (f.get("ext") == "m4a", f.get("abr") or 0), default=None)
    audio_size = _size(best_audio) if best_audio else None

    qualities = []
    for h in HEIGHTS:
        cands = [f for f in formats if f.get("height") == h and f.get("vcodec") not in (None, "none")]
        if not cands:
            continue
        best = max(cands, key=lambda f: (_size(f) is not None, str(f.get("vcodec", "")).startswith("avc"), f.get("tbr") or 0))
        vs = _size(best)
        qualities.append({
            "height": h,
            "fps": best.get("fps"),
            "size": (vs + (audio_size or 0)) if vs else None,
            "hdr": any((f.get("dynamic_range") or "SDR") != "SDR" for f in cands),
        })
    duration = info.get("duration")
    result = {
        "id": vid,
        "url": c["url"],
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "channel_url": info.get("channel_url") or info.get("uploader_url"),
        "duration": duration,
        "views": info.get("view_count"),
        "upload_date": info.get("upload_date"),
        "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        "live_status": info.get("live_status"),
        "short": c["short"] or "/shorts/" in (info.get("webpage_url") or ""),
        "qualities": qualities,
        "audio_size": audio_size,
        "mp3_size": int(duration * 320000 / 8) if duration else None,
    }
    _video_cache[vid] = (time.time(), result)
    return result
