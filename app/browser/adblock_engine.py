"""Network ad/tracker blocking using Brave's adblock-rust engine with EasyList-family filter lists."""
from __future__ import annotations

import threading
import time
import urllib.request
from pathlib import Path

import adblock

from ..config import CACHE_DIR

LISTS = {
    "easylist": "https://easylist.to/easylist/easylist.txt",
    "easyprivacy": "https://easylist.to/easylist/easyprivacy.txt",
    "ubo-filters": "https://ublockorigin.github.io/uAssets/filters/filters.txt",
    "ubo-privacy": "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
    "ubo-unbreak": "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
}
REFRESH_SECONDS = 3 * 24 * 3600

# Works offline from the first launch, before the full lists are downloaded.
BUILTIN = """
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||google-analytics.com^
||googletagservices.com^
||imasdk.googleapis.com^
||youtube.com/api/stats/ads^
||youtube.com/pagead/^
||youtube.com/ptracking^
||youtube.com/get_midroll_^
||www.youtube.com/youtubei/v1/player/ad_break^
||youtube.com/api/stats/atr^
||youtube.com/generate_204^$image
"""

# Never touch video streams, thumbnails or core API calls.
FAST_ALLOW = (
    ".googlevideo.com/", "://i.ytimg.com/", "://i9.ytimg.com/", "://yt3.ggpht.com/", "://yt3.googleusercontent.com/",
    "://www.youtube.com/youtubei/v1/browse", "://www.youtube.com/youtubei/v1/next", "://www.youtube.com/youtubei/v1/search",
    "://www.youtube.com/s/", "://fonts.gstatic.com/",
)

RESOURCE_TYPES = {
    "Document": "sub_frame",
    "Stylesheet": "stylesheet",
    "Image": "image",
    "Media": "media",
    "Font": "font",
    "Script": "script",
    "XmlHttpRequest": "xmlhttprequest",
    "Fetch": "fetch",
    "TextTrack": "other",
    "EventSource": "other",
    "Websocket": "websocket",
    "Manifest": "web_manifest",
    "Ping": "ping",
    "CspViolationReport": "csp_report",
}


def _engine_from_text(text: str) -> adblock.Engine:
    fs = adblock.FilterSet(debug=False)
    fs.add_filter_list(text, format="standard")
    return adblock.Engine(filter_set=fs, optimize=True)


class AdBlock:
    def __init__(self) -> None:
        self.engine = _engine_from_text(BUILTIN)
        self.full = False
        self.updated: float | None = None
        self.rules_dir = CACHE_DIR / "filters"
        self.rules_dir.mkdir(exist_ok=True)
        self.engine_file = self.rules_dir / "engine.dat"
        self._css_cache: dict[str, str] = {}

    def load_async(self) -> None:
        threading.Thread(target=self._load, daemon=True, name="adblock").start()

    def _load(self) -> None:
        try:
            if self.engine_file.exists():
                eng = adblock.Engine(adblock.FilterSet())
                eng.deserialize_from_file(str(self.engine_file))
                self.engine, self.full = eng, True
                self.updated = self.engine_file.stat().st_mtime
                if time.time() - self.updated < REFRESH_SECONDS:
                    return
        except Exception:
            self.engine_file.unlink(missing_ok=True)
        self.refresh()

    def refresh(self) -> None:
        texts = [BUILTIN]
        for name, url in LISTS.items():
            path: Path = self.rules_dir / f"{name}.txt"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "CuteTube"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read().decode("utf-8", "replace")
                path.write_text(data, "utf-8")
            except Exception:
                data = path.read_text("utf-8") if path.exists() else ""
            texts.append(data)
        if len(texts) == 1:
            return
        eng = _engine_from_text("\n".join(texts))
        eng.serialize_to_file(str(self.engine_file))
        self.engine, self.full, self.updated = eng, True, time.time()
        self._css_cache.clear()

    def should_block(self, url: str, source: str, context: str) -> bool:
        if any(p in url for p in FAST_ALLOW):
            return False
        rtype = RESOURCE_TYPES.get(context, "other")
        try:
            return bool(self.engine.check_network_urls(url, source, rtype).matched)
        except Exception:
            return False

    def cosmetic_css(self, url: str) -> str:
        host = url.split("/")[2] if "://" in url else url
        if host in self._css_cache:
            return self._css_cache[host]
        try:
            res = self.engine.url_cosmetic_resources(url)
            selectors = sorted(res.hide_selectors)
        except Exception:
            selectors = []
        # Chunk to keep one bad selector from invalidating the whole rule.
        css = "\n".join(f"{', '.join(selectors[i:i + 40])} {{ display: none !important; }}" for i in range(0, len(selectors), 40))
        self._css_cache[host] = css
        return css


adblocker = AdBlock()
