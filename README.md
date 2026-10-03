# CuteTube

A Windows app for browsing YouTube, Instagram, Facebook and TikTok without ads, and saving the videos and photos you want.

**[Download for Windows](https://github.com/FzArnob/cutetube/releases/latest/download/CuteTube-Setup.exe)** · [Website](https://fzarnob.github.io/cutetube/) · [Terms of Use](legal/TERMS.md) · [Privacy Policy](legal/PRIVACY.md)

- **Browse** the real sites inside the app, with ads and trackers blocked. A side panel changes with the page you're on:
  - **YouTube video / Short**: pick a quality (8K down to 144p, with estimated sizes) or audio only (MP3/M4A).
  - **Playlist**: download all of it, or tick the videos you want.
  - **Channel**: download Videos, Shorts and Live separately or together, sorted into `Channel/Videos`, `Channel/Shorts` and `Channel/Live`.
  - **Instagram, Facebook, TikTok post or profile**: save the photos and videos you can see while signed in, all of them or only photos or only videos.
  - **Any page**: turn on **Select**, click posts or thumbnails, then download the selection. Your selection is kept while you browse.
  - **Right-click** any video, then "Download video", "Download audio" or "Add to selection".
- **Downloads**: live progress, pause/resume (resumes where it stopped), cancel, retry, play, show in folder. The queue survives restarts.
- Tiles for things you've already downloaded show a green **Saved** badge. Bulk downloads can skip anything already downloaded.
- No accounts, analytics or tracking. See the [Privacy Policy](legal/PRIVACY.md).

## Install

Download **CuteTube-Setup.exe** from the [latest release](https://github.com/FzArnob/cutetube/releases/latest) and run it. It needs Windows 10 (1809 or newer) or Windows 11, 64-bit, and installs for your user account without administrator rights. The installer asks you to accept the Terms of Use and Privacy Policy.

On first start the app downloads **ffmpeg** (merging video and audio) and **Deno** (needed by YouTube's player) into `%LOCALAPPDATA%\CuteTube\bin`, unless they're already on your PATH. It also checks for new versions of yt-dlp and gallery-dl once a day (you can turn that off in Settings).

## Run from source

Requirements: Windows 10/11, Python 3.11+, Node 20+.

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
cd frontend; npm install; npm run build; cd ..
.venv\Scripts\python run.py        # or double-click start.bat
```

### Frontend development

```powershell
# terminal 1: UI with hot reload
cd frontend; npm run dev
# terminal 2: app pointed at the Vite dev server (fixed API port 8765, DevTools on 9222/9223)
$env:CUTETUBE_DEV=1; .venv\Scripts\python run.py
```

Set `CUTETUBE_CDP=1` to expose the Chrome DevTools ports (9222 for the app UI, 9223 for the site panes) when running the built UI.

## Build the installer

```powershell
.venv\Scripts\pip install pyinstaller
winget install JRSoftware.InnoSetup
powershell -ExecutionPolicy Bypass -File packaging\build.ps1   # -> dist\CuteTube-Setup.exe
```

## Release

1. Bump `__version__` in `app/__init__.py` (and `TERMS_VERSION` in `app/config.py` if the Terms or Privacy Policy changed in substance, so users are asked to accept them again).
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main --tags`.
3. The **Release** workflow builds the installer on GitHub from the tagged source, signs it when signing is set up, and publishes it as a GitHub Release. The **Site** workflow updates the website.

### Code signing

Releases are signed through the [SignPath Foundation](https://signpath.org/) free open-source program once the project is approved. To switch signing on:

1. Apply at https://signpath.org/apply with this repository.
2. In SignPath: link the predefined **GitHub.com** trusted build system to the project, install the SignPath GitHub App on this repository, and create two artifact configurations, `app` and `installer`, from [packaging/signpath](packaging/signpath).
3. In this repository's **Settings → Secrets and variables → Actions**: add the secret `SIGNPATH_API_TOKEN`, and the variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_POLICY_SLUG` (usually `release-signing`).

Until then, releases are built unsigned and Windows shows "Unknown publisher".

## How it works

| Piece | Where |
|---|---|
| Window + native site panes (WebView2 views layered over the React layout) | `app/main.py`, `app/browser/pane.py` |
| Ad blocking: Brave's adblock-rust engine with EasyList, EasyPrivacy and uBlock filters (network); page scripts remove what's left | `app/browser/adblock_engine.py`, `app/browser/inject/*.js` |
| Select mode, "Saved" badges, page context | `app/browser/inject/youtube.js`, `app/browser/inject/social.js` |
| Local API (REST + one WebSocket for live events), token-protected, 127.0.0.1 only | `app/server.py` |
| Download queue (yt-dlp, gallery-dl): folders, pause/resume, archive of downloaded IDs | `app/downloader.py`, `app/social.py` |
| Downloader updates in the installed app | `app/overlay.py`, `app/tools.py` |
| React UI (Vite, Tailwind v4, Zustand, Motion) | `frontend/src` |
| Installer (PyInstaller + Inno Setup), release and site workflows | `packaging/`, `.github/workflows/`, `site/` |

User data is stored in `%LOCALAPPDATA%\CuteTube`: settings, the job history, the archive of downloaded IDs, filter lists, and the built-in browser's profile (sign-ins).

## Legal

CuteTube is free software under the [GNU General Public License v2](LICENSE) (GPL-2.0-only). Bundled components keep their own licenses, listed in [THIRD-PARTY-NOTICES](legal/THIRD-PARTY-NOTICES.md).

CuteTube isn't affiliated with Google, YouTube, Meta, Instagram, Facebook or TikTok. Downloading may be against a site's terms of service. Only download content you have the right to. See the [Terms of Use](legal/TERMS.md).
