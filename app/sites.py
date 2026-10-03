"""Supported sites: tabs in the app, navigation policy, and link classification for Facebook/Instagram/TikTok."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, quote_plus, urlparse

SITES: dict[str, dict[str, Any]] = {
    "youtube": {
        "label": "YouTube",
        "home": "https://www.youtube.com/",
        "search": "https://www.youtube.com/results?search_query={q}",
        "hosts": r"youtube\.com|youtu\.be|youtube-nocookie\.com",
        "prefix": "",
    },
    "facebook": {
        "label": "Facebook",
        "home": "https://www.facebook.com/",
        "search": "https://www.facebook.com/search/top?q={q}",
        "hosts": r"facebook\.com|fb\.com|fb\.watch",
        "prefix": "fb:",
    },
    "instagram": {
        "label": "Instagram",
        "home": "https://www.instagram.com/",
        "search": "https://www.instagram.com/explore/search/keyword/?q={q}",
        "hosts": r"instagram\.com|instagr\.am",
        "prefix": "ig:",
    },
    "tiktok": {
        "label": "TikTok",
        "home": "https://www.tiktok.com/",
        "search": "https://www.tiktok.com/search?q={q}",
        "hosts": r"tiktok\.com",
        "prefix": "tt:",
    },
}

# Main-frame navigations allowed inside the embedded browser (site hosts + their login providers).
ALLOWED_NAV = re.compile(
    r"(^|\.)(youtube\.com|youtu\.be|google\.com|gstatic\.com|googleusercontent\.com|facebook\.com|fb\.com|fb\.watch|"
    r"messenger\.com|fbcdn\.net|instagram\.com|cdninstagram\.com|tiktok\.com|tiktokv\.com|tiktokcdn\.com|"
    r"apple\.com|appleid\.apple\.com|twitter\.com|x\.com|line\.me|kakao\.com)$"
)

_HOST_RE = {k: re.compile(rf"(^|\.)({v['hosts']})$") for k, v in SITES.items()}

IG_RESERVED = {"explore", "accounts", "direct", "reels", "stories", "p", "reel", "tv", "about", "legal", "emails",
               "challenge", "web", "developer", "api", "privacy", "terms", "session", "login", "data"}
FB_RESERVED = {"home.php", "watch", "groups", "marketplace", "gaming", "friends", "messages", "notifications", "reel",
               "reels", "stories", "photo", "photo.php", "search", "events", "pages", "bookmarks", "saved", "memories",
               "settings", "help", "login", "login.php", "privacy", "policies", "ads", "share", "video.php", "hashtag",
               "people", "places", "fundraisers", "business", "permalink.php", "story.php", "dialog", "sharer", "l.php"}
TT_RESERVED = {"foryou", "following", "explore", "live", "search", "discover", "tag", "music", "login", "upload",
               "messages", "friends", "setting", "coin", "inbox", "feedback", "legal", "about"}


def host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def site_of(url: str) -> str | None:
    h = host_of(url if "://" in url else "https://" + url)
    for site, rx in _HOST_RE.items():
        if rx.search(h):
            return site
    return None


def search_url(site: str, query: str) -> str:
    return SITES[site]["search"].format(q=quote_plus(query))


def _media(site: str, url: str, key: str, media_type: str, author: str | None = None) -> dict:
    return {"kind": "media", "site": site, "url": url, "id": SITES[site]["prefix"] + key,
            "media_type": media_type, "author": author}


def _profile(site: str, url: str, user: str, tab: str | None = None) -> dict:
    return {"kind": "profile", "site": site, "url": url, "user": user, "tab": tab}


def classify_social(url: str) -> dict:
    """Classify a Facebook / Instagram / TikTok URL (no network)."""
    site = site_of(url)
    if site not in ("facebook", "instagram", "tiktok"):
        return {"kind": "invalid", "url": url}
    u = urlparse(url if "://" in url else "https://" + url)
    host = (u.hostname or "").lower()
    path = re.sub(r"/{2,}", "/", u.path or "/")
    q = parse_qs(u.query)
    parts = [p for p in path.split("/") if p]

    if site == "tiktok":
        m = re.match(r"^/@([\w.-]+)/(video|photo)/(\d+)", path)
        if m:
            user, typ, vid = m.groups()
            return _media(site, f"https://www.tiktok.com/@{user}/{typ}/{vid}", vid, typ, user)
        if host.startswith(("vm.", "vt.")) and parts:
            return _media(site, f"https://{host}/{parts[0]}/", f"s:{parts[0]}", "video")
        if parts[:1] == ["t"] and len(parts) > 1:
            return _media(site, f"https://www.tiktok.com/t/{parts[1]}/", f"s:{parts[1]}", "video")
        m = re.match(r"^/@([\w.-]+)/?$", path)
        if m:
            return _profile(site, f"https://www.tiktok.com/@{m.group(1)}", m.group(1))

    elif site == "instagram":
        m = re.match(r"^/(?:[\w.]+/)?(p|reel|reels|tv)/([\w-]{5,})", path)
        if m:
            typ, code = m.groups()
            reel = typ in ("reel", "reels")
            return _media(site, f"https://www.instagram.com/{'reel' if reel else 'p'}/{code}/", code,
                          "reel" if reel else "post")
        m = re.match(r"^/stories/([\w.]+)/(\d+)", path)
        if m:
            return _media(site, f"https://www.instagram.com/stories/{m.group(1)}/{m.group(2)}/", f"s:{m.group(2)}",
                          "story", m.group(1))
        m = re.match(r"^/([\w.]{1,30})/(?:(reels|tagged|posts|saved)/?)?$", path)
        if m and m.group(1).lower() not in IG_RESERVED:
            return _profile(site, f"https://www.instagram.com/{m.group(1)}/", m.group(1), m.group(2))

    elif site == "facebook":
        if host == "fb.watch" and parts:
            return _media(site, f"https://fb.watch/{parts[0]}/", f"s:{parts[0]}", "video")
        if path.rstrip("/") in ("/watch", "/watch/live") and q.get("v"):
            v = q["v"][0]
            return _media(site, f"https://www.facebook.com/watch/?v={v}", v, "video")
        m = re.match(r"^/reel/(\d+)", path)
        if m:
            return _media(site, f"https://www.facebook.com/reel/{m.group(1)}", m.group(1), "reel")
        m = re.match(r"^/(?:[\w.-]+/)?videos/(?:[\w.-]+/)?(\d+)", path)
        if m:
            return _media(site, f"https://www.facebook.com/watch/?v={m.group(1)}", m.group(1), "video")
        m = re.match(r"^/share/([vrp])/([\w-]+)", path)
        if m:
            typ = {"v": "video", "r": "reel", "p": "post"}[m.group(1)]
            return _media(site, f"https://www.facebook.com/share/{m.group(1)}/{m.group(2)}/", f"s:{m.group(2)}", typ)
        m = re.match(r"^/share/([\w-]{6,})/?$", path)
        if m:
            return _media(site, f"https://www.facebook.com/share/{m.group(1)}/", f"s:{m.group(1)}", "post")
        if path.rstrip("/") in ("/photo", "/photo.php") and q.get("fbid"):
            fbid = q["fbid"][0]
            c = _media(site, f"https://www.facebook.com/photo/?fbid={fbid}", f"p:{fbid}", "photo")
            post_set = (q.get("set") or [""])[0]
            if re.match(r"^pcb\.\d+$", post_set):
                c["post_set"] = post_set  # the photo is part of a multi-photo post
            return c
        if path.rstrip("/") == "/media/set" and q.get("set"):
            s = q["set"][0]
            if re.match(r"^[\w.-]+$", s):
                return _media(site, f"https://www.facebook.com/media/set/?set={s}", f"set:{s}",
                              "post" if s.startswith("pcb.") else "album")
        if path.rstrip("/") in ("/permalink.php", "/story.php") and q.get("story_fbid") and q.get("id"):
            story, owner = q["story_fbid"][0], q["id"][0]
            if re.match(r"^[\w-]+$", story) and owner.isdigit():
                return _media(site, f"https://www.facebook.com/permalink.php?story_fbid={story}&id={owner}",
                              f"post:{story}", "post")
        m = re.match(r"^/groups/([\w.-]+)/(?:posts|permalink)/(\d+)", path)
        if m:
            return _media(site, f"https://www.facebook.com/groups/{m.group(1)}/posts/{m.group(2)}/", f"post:{m.group(2)}",
                          "post")
        m = re.match(r"^/(?:[\w.-]+)/photos/(?:[\w.-]+/)?(\d+)", path)
        if m:
            return _media(site, f"https://www.facebook.com/photo/?fbid={m.group(1)}", f"p:{m.group(1)}", "photo")
        m = re.match(r"^/([\w.-]+)/posts/([\w-]+)", path)
        if m:
            return _media(site, f"https://www.facebook.com/{m.group(1)}/posts/{m.group(2)}", f"post:{m.group(2)}",
                          "post", m.group(1))
        if path.rstrip("/") == "/profile.php" and q.get("id"):
            pid = q["id"][0]
            return _profile(site, f"https://www.facebook.com/profile.php?id={pid}", pid)
        m = re.match(r"^/([\w.-]{2,80})/?(?:(videos|photos|reels)/?)?$", path)
        if m and m.group(1).lower() not in FB_RESERVED:
            return _profile(site, f"https://www.facebook.com/{m.group(1)}", m.group(1), m.group(2))

    return {"kind": "page", "site": site, "url": url, "page": "home" if path in ("", "/") else "other"}


# Profile download categories per site (gallery-dl URLs), shown as cards in the side panel.
def profile_categories(site: str, user: str) -> list[dict]:
    if site == "instagram":
        base = f"https://www.instagram.com/{user}"
        return [
            {"key": "posts", "label": "Posts", "folder": "Posts", "url": f"{base}/posts/"},
            {"key": "reels", "label": "Reels", "folder": "Reels", "url": f"{base}/reels/"},
            {"key": "stories", "label": "Stories", "folder": "Stories", "url": f"https://www.instagram.com/stories/{user}/"},
            {"key": "highlights", "label": "Highlights", "folder": "Highlights", "url": f"{base}/highlights/"},
            {"key": "tagged", "label": "Tagged", "folder": "Tagged", "url": f"{base}/tagged/"},
        ]
    if site == "tiktok":
        base = f"https://www.tiktok.com/@{user}"
        return [
            {"key": "posts", "label": "Videos & photos", "folder": "Posts", "url": f"{base}/posts"},
            {"key": "reposts", "label": "Reposts", "folder": "Reposts", "url": f"{base}/reposts"},
            {"key": "stories", "label": "Stories", "folder": "Stories", "url": f"{base}/stories"},
        ]
    if site == "facebook":
        base = f"https://www.facebook.com/profile.php?id={user}" if user.isdigit() else f"https://www.facebook.com/{user}"
        sep = "&sk=" if user.isdigit() else "/"
        return [
            {"key": "photos", "label": "Photos", "folder": "Photos", "url": f"{base}{sep}photos"},
            {"key": "albums", "label": "Albums", "folder": "Albums", "url": f"{base}{sep}photos_albums"},
            {"key": "videos", "label": "Videos", "folder": "Videos", "url": f"{base}{sep}videos"},
        ]
    return []
