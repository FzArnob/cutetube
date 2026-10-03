"""Paths and persisted user settings."""
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from typing import Any

from . import APP_NAME

FROZEN = getattr(sys, "frozen", False)
ROOT = Path(sys._MEIPASS) if FROZEN else Path(__file__).resolve().parent.parent  # type: ignore[attr-defined]

DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share")) / APP_NAME
BIN_DIR = DATA_DIR / "bin"
PARTIAL_DIR = DATA_DIR / "partial"
CACHE_DIR = DATA_DIR / "cache"
PROFILE_MAIN = DATA_DIR / "webview-app"
PROFILE_YT = DATA_DIR / "webview-youtube"
SETTINGS_FILE = DATA_DIR / "settings.json"
JOBS_FILE = DATA_DIR / "jobs.json"
ARCHIVE_DIR = DATA_DIR / "archive"
COOKIES_FILE = DATA_DIR / "cookies.txt"

FRONTEND_DIST = ROOT / "frontend" / "dist"
LEGAL_DIR = ROOT / "legal"
LICENSE_FILE = ROOT / "LICENSE"
REPO_URL = "https://github.com/FzArnob/cutetube"
# Bump when legal/TERMS.md or legal/PRIVACY.md change in substance: everyone is asked to accept the new version.
TERMS_VERSION = 1
# The installer's "I accept" page leaves this behind so the app doesn't ask a second time.
INSTALLER_ACCEPTED = DATA_DIR / "terms-accepted.txt"
INJECT_DIR = ROOT / "app" / "browser" / "inject"

for d in (DATA_DIR, BIN_DIR, PARTIAL_DIR, CACHE_DIR, ARCHIVE_DIR):
    d.mkdir(parents=True, exist_ok=True)

DEV = os.environ.get("CUTETUBE_DEV") == "1"
# Exposes Chrome DevTools ports (9222 app UI, 9223 YouTube pane) for debugging/automation.
CDP = DEV or os.environ.get("CUTETUBE_CDP") == "1"


def _default_download_dir() -> str:
    return str(Path.home() / "Downloads" / APP_NAME)


DEFAULTS: dict[str, Any] = {
    "download_dir": _default_download_dir(),
    "organize_by_channel": True,
    "default_preset": "1080",
    "container": "mp4",
    "prefer_compatible": True,
    "audio_quality": "320",
    "embed_thumbnail": True,
    "embed_metadata": True,
    "embed_chapters": True,
    "embed_subs": False,
    "sub_langs": "en.*,en",
    "concurrency": 3,
    "skip_existing": True,
    "adblock": True,
    "use_login_cookies": False,
    "theme": "dark",
    "home_url": "https://www.youtube.com/",
    "auto_update": True,  # fetch new yt-dlp / gallery-dl daily
    "accepted_terms": 0,  # TERMS_VERSION the user agreed to; 0 = not yet
}

# Allowed values for validation of user-supplied settings.
CHOICES: dict[str, tuple] = {
    "default_preset": ("best", "2160", "1440", "1080", "720", "480", "360", "mp3", "m4a"),
    "container": ("mp4", "mkv"),
    "audio_quality": ("128", "192", "256", "320"),
    "theme": ("dark", "light", "system"),
}


class Settings:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data = dict(DEFAULTS)
        try:
            saved = json.loads(SETTINGS_FILE.read_text("utf-8"))
            self._data.update({k: v for k, v in saved.items() if k in DEFAULTS})
        except (OSError, ValueError):
            pass

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def all(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._data)

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        clean: dict[str, Any] = {}
        for k, v in patch.items():
            if k not in DEFAULTS:
                continue
            default = DEFAULTS[k]
            if isinstance(default, bool):
                v = bool(v)
            elif k == "concurrency":
                v = max(1, min(8, int(v)))
            elif isinstance(default, int):
                v = max(0, int(v))
            else:
                v = str(v)
                if k in CHOICES and v not in CHOICES[k]:
                    continue
            clean[k] = v
        with self._lock:
            self._data.update(clean)
            SETTINGS_FILE.write_text(json.dumps(self._data, indent=2), "utf-8")
            return dict(self._data)


settings = Settings()


def _installer_acceptance() -> None:
    try:
        version = int(INSTALLER_ACCEPTED.read_text("utf-8").strip() or 0)
    except (OSError, ValueError):
        return
    if version > settings["accepted_terms"]:
        settings.update({"accepted_terms": version})
    INSTALLER_ACCEPTED.unlink(missing_ok=True)


_installer_acceptance()
