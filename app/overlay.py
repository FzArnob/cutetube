"""Newer yt-dlp / gallery-dl for the installed app.

A packaged build has no pip, yet sites change their pages every few weeks and the downloaders ship fixes within
days. So the app fetches the downloaders' own wheels from PyPI (pure Python) into %LOCALAPPDATA%\\CuteTube\\pylib
and puts them in front of the bundled copies at start-up. An app update that bundles something newer wins again.
Must not import yt_dlp or gallery_dl: `activate()` runs before them.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

from . import APP_NAME

FROZEN = getattr(sys, "frozen", False)
PYLIB = Path(os.environ.get("LOCALAPPDATA", Path.home())) / APP_NAME / "pylib"
ACTIVE = PYLIB / "active.json"
# Downloaders we keep fresh. yt-dlp-ejs (YouTube's JS challenge solver) is pinned by yt-dlp and follows it.
PACKAGES = ("yt-dlp", "gallery-dl")


def _ver(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:4])


def _bundled(pkg: str) -> str:
    try:
        return importlib.metadata.version(pkg)
    except importlib.metadata.PackageNotFoundError:
        return "0"


def _read() -> dict[str, dict]:
    try:
        data = json.loads(ACTIVE.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def activate(clean: bool = False) -> None:
    """Put downloaded downloaders in front of the bundled ones (packaged builds only). `clean`: the app itself
    (not a helper process) also drops old downloads, which nothing running can be using yet."""
    if not FROZEN:
        return
    active = _read()
    keep = set()
    for pkg, entry in active.items():
        folder = PYLIB / str(entry.get("dir", ""))
        if folder.is_dir() and _ver(entry.get("version", "0")) > _ver(_bundled(pkg)):
            sys.path.insert(0, str(folder))
            keep.add(folder.name)
    # Old downloads nobody points at any more.
    if clean and PYLIB.is_dir():
        for d in PYLIB.iterdir():
            if d.is_dir() and d.name not in keep and not d.name.endswith(".part"):
                shutil.rmtree(d, ignore_errors=True)


def current(pkg: str) -> str:
    """Version in use after the next start: the newer of the bundled and the downloaded one."""
    entry = _read().get(pkg) or {}
    got = entry.get("version", "0")
    if (PYLIB / str(entry.get("dir", ""))).is_dir() and _ver(got) > _ver(_bundled(pkg)):
        return got
    return _bundled(pkg)


def _get(url: str, timeout: float = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": APP_NAME})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _wheel(pkg: str, version: str | None = None) -> tuple[str, bytes]:
    """(version, wheel bytes) of `pkg` from PyPI, checked against PyPI's sha256."""
    path = f"{pkg}/{version}" if version else pkg
    info = json.loads(_get(f"https://pypi.org/pypi/{path}/json", 30))
    version = info["info"]["version"]
    for f in info["urls"]:
        if f["packagetype"] == "bdist_wheel" and f["filename"].endswith("py3-none-any.whl"):
            data = _get(f["url"])
            if hashlib.sha256(data).hexdigest() != f["digests"]["sha256"]:
                raise RuntimeError(f"{pkg} {version}: download is corrupt")
            return version, data
    raise RuntimeError(f"{pkg} {version}: no pure-Python wheel")


def _extract(data: bytes, into: Path) -> None:
    tmp = into.with_suffix(".whl.part")
    tmp.write_bytes(data)
    try:
        with zipfile.ZipFile(tmp) as zf:
            zf.extractall(into)
    finally:
        tmp.unlink(missing_ok=True)


def _ejs_pin(folder: Path) -> str | None:
    for meta in folder.glob("yt_dlp-*.dist-info/METADATA"):
        m = re.search(r"^Requires-Dist: yt-dlp-ejs==([\w.]+); extra == .default.", meta.read_text("utf-8"), re.M)
        if m:
            return m.group(1)
    return None


def update(pkg: str) -> str | None:
    """Fetch the latest `pkg` if it's newer than what we have. Returns the new version, or None."""
    latest_info = json.loads(_get(f"https://pypi.org/pypi/{pkg}/json", 30))["info"]["version"]
    if _ver(latest_info) <= _ver(current(pkg)):
        return None
    version, data = _wheel(pkg, latest_info)
    PYLIB.mkdir(parents=True, exist_ok=True)
    name = f"{pkg}-{version}"
    part = PYLIB / f"{name}.part"
    shutil.rmtree(part, ignore_errors=True)
    part.mkdir()
    try:
        _extract(data, part)
        if pkg == "yt-dlp":
            pin = _ejs_pin(part)
            if pin and pin != _bundled("yt-dlp-ejs"):
                _extract(_wheel("yt-dlp-ejs", pin)[1], part)
        final = PYLIB / name
        shutil.rmtree(final, ignore_errors=True)
        part.rename(final)
    except BaseException:
        shutil.rmtree(part, ignore_errors=True)
        raise
    active = _read()
    active[pkg] = {"dir": name, "version": version}
    tmp = ACTIVE.with_suffix(".tmp")
    tmp.write_text(json.dumps(active, indent=2), "utf-8")
    os.replace(tmp, ACTIVE)
    return version
