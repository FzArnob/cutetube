"""Details for a single Facebook / Instagram / TikTok post, for the side panel before downloading."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import yt_dlp

from . import ytdl
from .downloader import pick_tool
from .resolver import classify
from .sites import SITES
from .ytdl import YTLogger, base_opts, clean_error

_cache: dict[str, tuple[float, dict]] = {}


class NoMedia(RuntimeError):
    """The page was read fine and simply has no photos or videos (e.g. a text post)."""
HEIGHTS = (2160, 1440, 1080, 720, 480, 360, 240)


VIDEO_EXT = ("mp4", "webm", "mov", "m4v")
IMAGE_EXT = ("jpg", "jpeg", "png", "webp", "heic", "gif", "avif")
FB_PHOTO = "https://www.facebook.com/photo/?fbid={}"
FB_VIDEO = "https://www.facebook.com/watch/?v={}"


def _from_ytdlp(url: str, site: str) -> dict:
    with yt_dlp.YoutubeDL(base_opts(YTLogger(), site=site) | {"skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False, process=False)
        for _ in range(3):  # e.g. Facebook reels hand over to the /watch page
            if info.get("_type") not in ("url", "url_transparent") or not info.get("url"):
                break
            info = ydl.extract_info(info["url"], download=False, process=False)
    if info.get("_type") == "playlist" or not info.get("formats"):
        raise RuntimeError("No video found here.")
    formats = info.get("formats") or []
    heights = sorted({f["height"] for f in formats if f.get("height") and f.get("vcodec") not in (None, "none")},
                     reverse=True)
    qualities = []
    for h in heights:
        cands = [f for f in formats if f.get("height") == h]
        size = max((f.get("filesize") or f.get("filesize_approx") or 0) for f in cands) or None
        qualities.append({"height": h, "size": size})
    return {
        "type": "video",
        "title": info.get("title") or info.get("description"),
        "author": info.get("channel") or info.get("uploader") or info.get("uploader_id"),
        "thumb": info.get("thumbnail"),
        "duration": info.get("duration"),
        "views": info.get("view_count"),
        "count": 1,
        "qualities": qualities,
    }


def _from_gallery(url: str, site: str) -> dict:
    cmd = [sys.executable, "-m", "gallery_dl", "-j", "--range", "1-60"]
    cookies = ytdl.social_cookies(site)
    if cookies:
        cmd += ["--cookies", cookies]
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    try:
        out = subprocess.run(cmd + [url], capture_output=True, text=True, encoding="utf-8", errors="replace", env=env,
                             timeout=90, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    finally:
        ytdl.drop_copy(cookies)
    try:
        messages = json.loads(out.stdout or "[]")
    except ValueError:
        messages = []
    files = [m for m in messages if isinstance(m, list) and len(m) >= 3 and m[0] == 3 and isinstance(m[2], dict)]
    if not files:
        err = [ln for ln in (out.stderr or "").splitlines() if "error" in ln.lower()]
        raise RuntimeError(err[-1].split("] ", 1)[-1] if err else "No photos or videos found in this post.")
    meta: dict[str, Any] = files[0][2]
    videos = sum(1 for f in files if str(f[2].get("extension", "")).lower() in VIDEO_EXT)
    author = meta.get("username") or meta.get("owner_username") or meta.get("fullname")
    if isinstance(meta.get("author"), dict):
        author = author or meta["author"].get("uniqueId") or meta["author"].get("nickname")
    elif isinstance(meta.get("user"), dict):
        author = author or meta["user"].get("name")
    images = [f[1] for f in files if str(f[2].get("extension", "")).lower() in IMAGE_EXT]
    return {
        "type": "video" if videos == len(files) else "photos" if videos == 0 else "mixed",
        # Facebook's "title" is the album's name ("Photos"), not something about this post.
        "title": meta.get("description") or meta.get("desc") or meta.get("caption")
        or (meta.get("title") if site != "facebook" else None),
        "author": author,
        "thumb": meta.get("display_url") or meta.get("thumbnail") or (images[0] if images else None),
        "duration": None,
        "views": None,
        "count": len(files),
        "videos": videos,
        "photos": len(files) - videos,
        "qualities": [],
    }


def _settled(results: list[dict]) -> bool:
    """The post finished rendering: the same media in two polls in a row (text-only posts: give it a few)."""
    last = results[-1]
    if not last.get("ready") or len(results) < 3:
        return False
    same = results[-2].get("parts") == last.get("parts")
    return same and (bool(last.get("parts")) or len(results) >= 7)


def _set_settled(results: list[dict]) -> bool:
    n = [len(r.get("parts") or []) for r in results]
    return len(n) >= 4 and n[-1] > 0 and n[-1] == n[-2] == n[-3]


def facebook_post(url: str) -> dict:
    """Photos and videos of a Facebook post or photo set, read from what Facebook shows the logged-in user.
    (yt-dlp and gallery-dl parse these pages heuristically and often pick up a different post or an ad.)"""
    from .browser.pane import INJECT_DIR, pane

    script = (INJECT_DIR / "resolve_facebook.js").read_text("utf-8")
    on_set = "/media/set" in url
    r = pane.resolver.run(url, script, _set_settled if on_set else _settled, scroll=on_set, timeout=(120 if "set=pcb." not in url else 45) if on_set else 25)
    if not r:
        raise RuntimeError("Couldn't open this Facebook post. Try again.")
    if r.get("login"):
        raise RuntimeError("Facebook needs you to be signed in to see this. Sign in on the Facebook tab, then try again.")
    parts: list[dict] = list(r.get("parts") or [])
    if r.get("set") and not r.get("onSet") and (r.get("more") or len(parts) >= 4):
        # A grid shows at most 5 items; the post's photo set has all of them, in order.
        s = pane.resolver.run(f"https://www.facebook.com/media/set/?set={r['set']}", script, _set_settled,
                              scroll=True, timeout=45)
        if s and s.get("parts"):
            ids = {p["id"] for p in s["parts"]}
            parts = s["parts"] + [p for p in parts if p["id"] not in ids]
    if not parts:
        if r.get("found"):
            raise NoMedia("No photos or videos in this post.")
        raise RuntimeError("Couldn't find this post's photos or videos.")
    author = r.get("author")
    if not author:  # a photo set page doesn't name its owner; the first photo's page does
        first = next((p for p in parts if p["type"] == "photo"), None)
        try:
            author = first and _from_gallery(FB_PHOTO.format(first["id"]), "facebook").get("author")
        except Exception:
            author = None
    videos = sum(1 for p in parts if p["type"] == "video")
    return {
        "type": "video" if videos == len(parts) else "photos" if videos == 0 else "mixed",
        "title": r.get("title"),
        "author": author,
        "thumb": r.get("thumb") or next((p["thumb"] for p in parts if p.get("thumb")), None),
        "duration": None,
        "views": None,
        "count": len(parts),
        "videos": videos,
        "photos": len(parts) - videos,
        "qualities": [],
        "parts": [{"type": p["type"], "id": p["id"], "thumb": p.get("thumb")} for p in parts],
    }


def _full_stream(url: str) -> str:
    """Players fetch streams in byte ranges (bytestart/byteend); without them the CDN serves the whole file."""
    u = urlsplit(url)
    q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k not in ("bytestart", "byteend")]
    return urlunsplit(u._replace(query=urlencode(q)))


def _generic_settled(results: list[dict]) -> bool:
    last = results[-1]
    if not last.get("ready"):
        return False
    if last.get("videoElements"):
        return len(results) >= 6  # let the (muted) players run a few seconds so their streams are requested
    return len(results) >= 3 and results[-2].get("images") == last.get("images")


def browser_media(url: str) -> dict:
    """Last resort that relies on nothing site-specific: open the page in the logged-in browser and take the
    large images on it and the video streams it plays. Keeps working when a site changes its page code."""
    from .browser.pane import INJECT_DIR, pane

    script = (INJECT_DIR / "resolve_generic.js").read_text("utf-8")
    r = pane.resolver.run(url, script, _generic_settled, timeout=30, capture=True)
    if not r:
        raise RuntimeError("Couldn't open this page. Try again.")
    if r.get("login"):
        raise RuntimeError("You need to be signed in to see this. Sign in on this tab, then try again.")
    direct = list(dict.fromkeys((r.get("videos") or []) + (r.get("ogVideo") or [])))
    has_video = bool(direct or r.get("videoElements"))
    # The preview image stands in for the photo only when the page shows no video (else it's the video's cover).
    photos = r.get("images") or ([] if has_video else (r.get("ogImage") or [])[:1])
    items: list[dict] = [{"type": "photo", "url": u} for u in photos]
    if direct:
        items += [{"type": "video", "url": u} for u in direct]
    elif r.get("streams") and r.get("videoElements"):
        video, audio = [], []
        for u, ctype in r["streams"]:
            full = _full_stream(u)
            bucket = audio if ctype.startswith("audio/") else video
            if full not in video and full not in audio:
                bucket.append(full)
        if video or audio:
            items.append({"type": "video", "streams": video[:6], "audio": audio[:3]})
    if not items:
        raise RuntimeError("No photos or videos found on this page.")
    videos = sum(1 for i in items if i["type"] == "video")
    photos = [i["url"] for i in items if i["type"] == "photo"]
    return {
        "type": "video" if videos == len(items) else "photos" if videos == 0 else "mixed",
        "title": (r.get("title") or "").strip() or None,
        "author": None,
        "thumb": (photos[0] if photos else None) or next(iter(r.get("ogImage") or []), None),
        "duration": None,
        "views": None,
        "count": len(items),
        "videos": videos,
        "photos": len(items) - videos,
        "qualities": [],
        "direct": items,
    }


def is_composite(site: str, media_type: str | None) -> bool:
    """Facebook posts and photo sets: downloaded item by item from the list the browser saw."""
    return site == "facebook" and media_type in ("post", "album")


def part_urls(url: str, only: str | None = None) -> tuple[list[str], dict]:
    """Download URLs for every photo / video of a Facebook post (cached from the side panel when possible)."""
    info = media_info(url)
    parts = [p for p in info.get("parts") or []
             if not only or (only == "videos") == (p["type"] == "video")]
    return [(FB_VIDEO if p["type"] == "video" else FB_PHOTO).format(p["id"]) for p in parts], info


def media_info(url: str) -> dict:
    c = classify(url)
    if c.get("kind") != "media":
        raise ValueError("Not a post / video link")
    site = c["site"]
    hit = _cache.get(c["id"])
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    tool = pick_tool(site, c.get("media_type"), "best")
    errors: list[str] = []
    info = None
    empty = False
    attempts: tuple[str, ...] = (tool, "gallery" if tool == "ytdlp" else "ytdlp")
    if is_composite(site, c.get("media_type")):
        attempts = ("browser",)
    elif site == "facebook":
        attempts = (tool,)  # the other tool reads the wrong item on Facebook pages
    attempts += ("generic",)  # whatever the logged-in browser shows, if the downloaders can't read the page
    for attempt in attempts:
        try:
            info = (facebook_post(c["url"]) if attempt == "browser" else
                    browser_media(c["url"]) if attempt == "generic" else
                    _from_ytdlp(c["url"], site) if attempt == "ytdlp" else _from_gallery(c["url"], site))
            break
        except NoMedia as e:
            errors.append(str(e))
            empty = True
            break
        except Exception as e:  # try the other tool before giving up
            errors.append(clean_error(e))
    if info is None:
        msg = errors[0] if errors else "Couldn't read this post."
        low = " ".join(errors).lower()
        if any(k in low for k in ("login", "log in", "cookies", "401", "authenticat", "empty media")):
            label = SITES[site]["label"]
            msg = f"{label} needs you to be signed in to see this. Sign in on the {label} tab, then try again."
        raise (NoMedia if empty else RuntimeError)(msg)
    info.update({"id": c["id"], "url": c["url"], "site": site, "media_type": c.get("media_type"),
                 "post_set": c.get("post_set")})
    info["author"] = info.get("author") or c.get("author")
    if isinstance(info.get("title"), str):
        info["title"] = info["title"].strip()[:400] or None
    _cache[c["id"]] = (time.time(), info)
    return info
