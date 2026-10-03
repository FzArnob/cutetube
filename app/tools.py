"""Locate or fetch the external binaries yt-dlp needs (ffmpeg for merging, deno for YouTube's JS challenges)."""
from __future__ import annotations

import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

from . import overlay
from .config import BIN_DIR, DATA_DIR, FROZEN
from .events import bus

SOURCES = {
    "ffmpeg": {
        "url": "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
        "files": ("ffmpeg.exe", "ffprobe.exe"),
    },
    "deno": {
        "url": "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip",
        "files": ("deno.exe",),
    },
}


class Tools:
    def __init__(self) -> None:
        self.state: dict[str, dict] = {
            name: {"ok": False, "path": None, "busy": False, "progress": 0.0, "error": None} for name in SOURCES
        }
        self.state["yt-dlp"] = {"ok": True, "version": _ytdlp_version(), "gallery": _gallery_version(), "busy": False,
                                "error": None, "restart": False}
        self._lock = threading.Lock()
        self.ready = threading.Event()

    # -- lookup -----------------------------------------------------------
    def path(self, name: str) -> str | None:
        return self.state[name]["path"]

    def _find(self, name: str) -> str | None:
        local = BIN_DIR / SOURCES[name]["files"][0]
        if local.exists():
            return str(local)
        return shutil.which(name)

    def snapshot(self) -> dict:
        return {k: dict(v) for k, v in self.state.items()}

    def _emit(self) -> None:
        bus.publish("tools", self.snapshot())

    # -- setup ------------------------------------------------------------
    def ensure_all(self) -> None:
        threading.Thread(target=self._ensure_all, daemon=True, name="tools").start()

    def _ensure_all(self) -> None:
        for name in SOURCES:
            found = self._find(name)
            if found:
                self.state[name].update(ok=True, path=found)
            else:
                self._download(name)
        self._emit()
        self.ready.set()

    def _download(self, name: str) -> None:
        st = self.state[name]
        st.update(busy=True, progress=0.0, error=None)
        self._emit()
        src = SOURCES[name]
        tmp = BIN_DIR / f"{name}.download.zip"
        try:
            req = urllib.request.Request(src["url"], headers={"User-Agent": "CuteTube"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, "wb") as out:
                total = int(resp.headers.get("Content-Length") or 0)
                done = 0
                while chunk := resp.read(1 << 16):
                    out.write(chunk)
                    done += len(chunk)
                    if total:
                        st["progress"] = done / total
                        bus.publish("tools", self.snapshot(), throttle_key=f"tools-{name}", interval=0.3)
            with zipfile.ZipFile(tmp) as zf:
                for member in zf.namelist():
                    base = Path(member).name
                    if base in src["files"]:
                        with zf.open(member) as zsrc, open(BIN_DIR / base, "wb") as dst:
                            shutil.copyfileobj(zsrc, dst)
            st.update(ok=True, path=str(BIN_DIR / src["files"][0]), progress=1.0)
        except Exception as e:  # network errors, bad zip, disk full...
            st.update(ok=False, error=str(e))
        finally:
            st["busy"] = False
            tmp.unlink(missing_ok=True)
            self._emit()

    def retry(self) -> None:
        self.ready.clear()
        self.ensure_all()

    # -- downloader updates -------------------------------------------------
    # Sites change their pages often; yt-dlp and gallery-dl usually ship a fix within days.
    def update_ytdlp(self, silent: bool = False) -> None:
        """Update yt-dlp and gallery-dl. `silent`: the daily background check, which only speaks up on news."""
        st = self.state["yt-dlp"]
        if st["busy"]:
            return
        def run() -> None:
            st.update(busy=True, error=None)
            self._emit()
            try:
                old_gallery = _gallery_version()
                if FROZEN:
                    # No pip in the installed app: fetch the downloaders' wheels (see overlay.py).
                    new = overlay.update("yt-dlp") or ""
                    overlay.update("gallery-dl")
                else:
                    out = subprocess.run(
                        [sys.executable, "-m", "pip", "install", "-U", "--disable-pip-version-check",
                         "yt-dlp[default]", "gallery-dl"],
                        capture_output=True, text=True, timeout=300, creationflags=_NO_WINDOW,
                    )
                    if out.returncode != 0:
                        raise RuntimeError(out.stderr.strip().splitlines()[-1] if out.stderr.strip() else "pip failed")
                    new = subprocess.run(
                        [sys.executable, "-c", "import yt_dlp.version as v; print(v.__version__)"],
                        capture_output=True, text=True, creationflags=_NO_WINDOW,
                    ).stdout.strip()
                _LAST_UPDATE.write_text(str(time.time()), "utf-8")
                gallery = _gallery_version()
                if new and new != st["version"]:
                    st.update(latest=new, restart=True)
                    bus.toast(f"yt-dlp updated to {new}. Restart CuteTube to use it.", "success")
                elif not silent:
                    bus.toast("yt-dlp is already up to date.", "success")
                if gallery and gallery != old_gallery:
                    st["gallery"] = gallery  # runs as its own process: in use right away
                    bus.toast(f"Photo downloader updated to {gallery}.", "success")
            except Exception as e:
                st["error"] = str(e)
                if not silent:
                    bus.toast(f"yt-dlp update failed: {e}", "error")
            finally:
                st["busy"] = False
                self._emit()

        threading.Thread(target=run, daemon=True, name="tools-update").start()

    def auto_update(self) -> None:
        """Once a day, quietly fetch the latest yt-dlp / gallery-dl."""
        try:
            last = float(_LAST_UPDATE.read_text("utf-8"))
        except (OSError, ValueError):
            last = 0.0
        if time.time() - last > 20 * 3600:
            self.update_ytdlp(silent=True)


_LAST_UPDATE = DATA_DIR / "last-tools-update.txt"
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _gallery_version() -> str:
    # Asked of a fresh process: gallery-dl always runs as one, so this is the version downloads will use.
    try:
        out = subprocess.run([sys.executable, "-m", "gallery_dl", "--version"],
                             capture_output=True, text=True, timeout=30, creationflags=_NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""


def _ytdlp_version() -> str:
    from yt_dlp.version import __version__

    return __version__


tools = Tools()
