"""Build the download site (GitHub Pages) into _site/: the landing page plus the Terms, Privacy Policy and
third-party notices rendered from legal/*.md, so the site always says exactly what the app shows.
Run: python site/build.py   (needs `pip install markdown`)"""
from __future__ import annotations

import html
import re
import shutil
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = ROOT / "_site"
REPO = "https://github.com/FzArnob/cutetube"

PAGES = {
    "terms": ("TERMS.md", "Terms of Use"),
    "privacy": ("PRIVACY.md", "Privacy Policy"),
    "notices": ("THIRD-PARTY-NOTICES.md", "Third-party notices"),
}


def version() -> str:
    return re.search(r'__version__ = "(.+)"', (ROOT / "app" / "__init__.py").read_text("utf-8")).group(1)


def linkify(body: str) -> str:
    # Bare URLs in the legal texts become links (markdown leaves them as text).
    return re.sub(r'(?<!["=>])(https?://[^\s<)|]+)', r'<a href="\1">\1</a>', body)


def main() -> None:
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir()
    layout = (SITE / "layout.html").read_text("utf-8")
    for name in ("style.css", "index.html"):
        shutil.copy(SITE / name, OUT / name)
    shutil.copy(ROOT / "app" / "assets" / "cutetube-512.png", OUT / "icon.png")
    index = (OUT / "index.html").read_text("utf-8").replace("{{version}}", version()).replace("{{repo}}", REPO)
    (OUT / "index.html").write_text(index, "utf-8")
    for slug, (src, title) in PAGES.items():
        body = markdown.markdown((ROOT / "legal" / src).read_text("utf-8"), extensions=["tables"])
        page = layout.replace("{{title}}", html.escape(title)).replace("{{body}}", linkify(body)).replace("{{repo}}", REPO)
        (OUT / f"{slug}.html").write_text(page, "utf-8")
    (OUT / ".nojekyll").write_text("", "utf-8")
    print("built", sorted(p.name for p in OUT.iterdir()), file=sys.stderr)


if __name__ == "__main__":
    main()
