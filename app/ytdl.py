"""Shared yt-dlp option building and error cleanup."""
from __future__ import annotations

import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from .config import CACHE_DIR, COOKIES_FILE, settings
from .tools import tools


# Set by main: refreshes cookies.txt from the YouTube pane when login cookies are enabled.
cookie_hook: Callable[[], None] | None = None
# Set by main: returns a fresh cookies.txt path for facebook / instagram / tiktok.
social_cookie_hook: Callable[[str], str | None] | None = None


_COOKIE_COPIES = CACHE_DIR / "cookies"


def social_cookies(site: str) -> str | None:
    """A private copy of the site's cookies.txt. yt-dlp and gallery-dl write cookies back into the file they
    are given, which would otherwise overwrite the browser export (and race between parallel jobs)."""
    path = social_cookie_hook(site) if social_cookie_hook else None
    if not path:
        return None
    _COOKIE_COPIES.mkdir(parents=True, exist_ok=True)
    for old in _COOKIE_COPIES.glob("*.txt"):
        try:
            if time.time() - old.stat().st_mtime > 6 * 3600:
                old.unlink()
        except OSError:
            pass
    fd, copy = tempfile.mkstemp(prefix=f"{site}-", suffix=".txt", dir=_COOKIE_COPIES)
    os.close(fd)
    shutil.copyfile(path, copy)
    return copy


def drop_copy(path: str | None) -> None:
    if path and Path(path).parent == _COOKIE_COPIES:
        try:
            os.remove(path)
        except OSError:
            pass


class YTLogger:
    """Swallows yt-dlp console output but remembers warnings/errors for friendlier reporting."""

    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.errors: list[str] = []

    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        self.warnings.append(msg)

    def error(self, msg: str) -> None:
        self.errors.append(msg)


def base_opts(logger: YTLogger | None = None, site: str = "youtube") -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "logger": logger or YTLogger(),
        "socket_timeout": 20,
        "retries": 10,
        "fragment_retries": 10,
        "extractor_retries": 3,
        "noplaylist": True,
    }
    deno = tools.path("deno")
    if deno:
        opts["js_runtimes"] = {"deno": {"path": deno}}
    ffmpeg = tools.path("ffmpeg")
    if ffmpeg:
        opts["ffmpeg_location"] = ffmpeg
    if site != "youtube":
        path = social_cookies(site)
        if path:
            opts["cookiefile"] = path
        return opts
    if settings["use_login_cookies"] and cookie_hook:
        try:
            cookie_hook()
        except Exception:
            pass
    if settings["use_login_cookies"] and COOKIES_FILE.exists():
        opts["cookiefile"] = str(COOKIES_FILE)
    return opts


_PREFIX = re.compile(r"^(ERROR:\s*)?(\[[^\]]+\]\s*)?([@A-Za-z0-9_-]{11,64}:\s*)?(YouTube said:\s*)?")


def clean_error(e: BaseException | str) -> str:
    msg = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__ if isinstance(e, BaseException) else "Unknown error"
    msg = _PREFIX.sub("", msg)
    lower = msg.lower()
    if "sign in to confirm" in lower and "bot" in lower:
        return "YouTube asked to confirm you're not a bot. Try again later or enable 'Use my YouTube login' in Settings."
    if "sign in to confirm your age" in lower or "age-restricted" in lower:
        return "Age-restricted video. Sign in on the Browse tab and enable 'Use my YouTube login' in Settings."
    if "members-only" in lower or "join this channel" in lower:
        return "Members-only video. Requires your YouTube login (see Settings)."
    if "private video" in lower:
        return "This video is private."
    if "ffmpeg" in lower and "not found" in lower:
        return "ffmpeg is missing. Open Settings > Tools to install it."
    return msg[:300]
