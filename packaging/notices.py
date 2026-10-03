"""Write legal/THIRD-PARTY-NOTICES.md from the Python packages actually installed for the build, and
build/agreement.txt (Terms + Privacy Policy as plain text for the installer's "I accept" page).
Run by packaging/build.ps1 with the build's Python."""
from __future__ import annotations

import importlib.metadata as md
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KNOWN = {"clr_loader": "MIT", "clr-loader": "MIT"}  # packages whose metadata omits the license
SKIP = {"pip", "setuptools", "wheel", "pyinstaller", "pyinstaller-hooks-contrib", "altgraph", "pefile",
        "pywin32-ctypes", "packaging"}


def _license(dist: md.Distribution) -> str:
    m = dist.metadata
    lic = m.get("License-Expression") or ""
    if not lic:
        lic = ", ".join(c.split("::")[-1].strip() for c in m.get_all("Classifier") or [] if c.startswith("License ::"))
    if not lic and m.get("License"):
        lic = m["License"].strip().splitlines()[0][:60]
    return lic.strip() or KNOWN.get(m["Name"].lower(), "see project")


def _home(dist: md.Distribution) -> str:
    m = dist.metadata
    for u in m.get_all("Project-URL") or []:
        name, _, url = u.partition(",")
        if name.strip().lower() in ("homepage", "home", "source", "repository", "source code"):
            return url.strip()
    return (m.get("Home-page") or "").strip() or f"https://pypi.org/project/{m['Name']}/"


def _bundled() -> list[md.Distribution]:
    """requirements.txt and everything it pulls in on this machine (what PyInstaller bundles)."""
    from packaging.requirements import Requirement

    todo = []
    for line in (ROOT / "requirements.txt").read_text("utf-8").splitlines():
        line = line.split("#")[0].strip()
        if line:
            todo.append(Requirement(line))
    seen: dict[str, md.Distribution] = {}
    while todo:
        req = todo.pop()
        key = req.name.lower().replace("_", "-")
        try:
            dist = md.distribution(req.name)
        except md.PackageNotFoundError:
            continue  # a dependency for another platform / Python
        if key not in seen:
            seen[key] = dist
        for dep in dist.requires or []:
            r = Requirement(dep)
            if r.marker is None or any(r.marker.evaluate({"extra": e}) for e in (req.extras or {""})):
                if r.name.lower().replace("_", "-") not in seen:
                    todo.append(r)
    return [seen[k] for k in sorted(seen) if k not in SKIP]


def python_rows() -> list[str]:
    return [f"| {d.metadata['Name']} | {d.version} | {_license(d)} | {_home(d)} |" for d in _bundled()]


def npm_rows() -> list[str]:
    pkg = json.loads((ROOT / "frontend" / "package.json").read_text("utf-8"))
    rows = []
    for name in sorted(pkg.get("dependencies", {})):
        meta = ROOT / "frontend" / "node_modules" / name / "package.json"
        try:
            info = json.loads(meta.read_text("utf-8"))
        except OSError:
            continue
        lic = info.get("license") or "see project"
        rows.append(f"| {name} | {info.get('version', '')} | {lic} | https://www.npmjs.com/package/{name} |")
    return rows


def notices() -> str:
    return "\n".join([
        "# Third-party notices",
        "",
        "CuteTube is licensed under GPL-2.0-only (see `LICENSE`). It includes the components below, each under its own"
        " license. Components under the GPL are included with their complete source code in the installed app"
        " (`_internal\\gallery_dl`, `_internal\\mutagen`), and the source of every CuteTube release is published at"
        " https://github.com/FzArnob/cutetube.",
        "",
        "## Included in the app",
        "",
        "| Component | Version | License | Project |",
        "|---|---|---|---|",
        "| Python | 3.13 | PSF-2.0 | https://www.python.org/ |",
        *python_rows(),
        "",
        "## Interface",
        "",
        "| Component | Version | License | Project |",
        "|---|---|---|---|",
        *npm_rows(),
        "| Simple Icons (site logos) | | CC0-1.0 | https://simpleicons.org/ |",
        "",
        "Site names and logos are trademarks of their owners. They identify the sites only; CuteTube isn't affiliated"
        " with them.",
        "",
        "## Downloaded on first use (not part of the installer)",
        "",
        "| Component | License | Source |",
        "|---|---|---|",
        "| FFmpeg (yt-dlp builds) | GPL-3.0 | https://github.com/yt-dlp/FFmpeg-Builds |",
        "| Deno | MIT | https://github.com/denoland/deno |",
        "| EasyList, EasyPrivacy | GPL-3.0 / CC BY-SA 3.0 | https://easylist.to/ |",
        "| uBlock Origin filter lists | GPL-3.0 | https://github.com/uBlockOrigin/uAssets |",
        "",
        "## Part of Windows",
        "",
        "Microsoft Edge WebView2 Runtime, under Microsoft's license terms: https://developer.microsoft.com/microsoft-edge/webview2/",
        "",
    ])


def plain(md_text: str) -> str:
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", md_text)
    t = t.replace("`", "")
    t = re.sub(r"^#+\s*", "", t, flags=re.M)
    t = re.sub(r"^\|---.*\n", "", t, flags=re.M)
    t = re.sub(r"^\| (.+) \|$", lambda m: "  " + m.group(1).replace(" | ", " - "), t, flags=re.M)
    return t


def main() -> None:
    (ROOT / "legal" / "THIRD-PARTY-NOTICES.md").write_text(notices(), "utf-8")
    terms = (ROOT / "legal" / "TERMS.md").read_text("utf-8")
    privacy = (ROOT / "legal" / "PRIVACY.md").read_text("utf-8")
    intro = ("Please read the CuteTube Terms of Use and Privacy Policy below. You must accept them to install CuteTube.\r\n"
             "CuteTube is free software under the GNU General Public License v2 (see LICENSE in the install folder).\r\n\r\n")
    text = intro + plain(terms) + "\n\n" + "=" * 60 + "\n\n" + plain(privacy)
    out = ROOT / "build" / "agreement.txt"
    out.parent.mkdir(exist_ok=True)
    out.write_text(text.replace("\r\n", "\n").replace("\n", "\r\n"), "utf-8-sig")


if __name__ == "__main__":
    main()
