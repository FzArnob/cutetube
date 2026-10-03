"""Local FastAPI server: REST for commands, one WebSocket for live events, and the built React app."""
from __future__ import annotations

import asyncio
import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .browser.adblock_engine import adblocker
from .browser.pane import pane
from .config import FRONTEND_DIST, LEGAL_DIR, LICENSE_FILE, REPO_URL, TERMS_VERSION, settings
from .downloader import archive, downloader, open_path
from .events import bus
from .resolver import channel_info, classify, listings, video_info
from .tools import tools
from .ytdl import clean_error


class NavBody(BaseModel):
    action: str = "go"
    url: str | None = None


class LayoutBody(BaseModel):
    left: float
    top: float
    right: float
    bottom: float
    dpr: float = 1.0
    visible: bool = True


class ToggleBody(BaseModel):
    on: bool


class UrlBody(BaseModel):
    url: str


class ListingBody(BaseModel):
    url: str
    tab: str | None = None
    refresh: bool = False


class DownloadItem(BaseModel):
    url: str
    title: str | None = None
    thumb: str | None = None
    channel: str | None = None
    duration: float | None = None
    index: int | None = None


class DownloadBody(BaseModel):
    items: list[DownloadItem] = Field(max_length=10000)
    preset: str
    folder: dict[str, Any] | None = None
    skip_existing: bool = False
    only: str | None = None  # "photos" | "videos" for social posts


class PlaylistDownloadBody(BaseModel):
    items: list[DownloadItem] = Field(max_length=500)
    preset: str
    skip_existing: bool = True


class BatchBody(BaseModel):
    ids: list[str] = Field(max_length=20000)
    action: str


class CollectionItem(BaseModel):
    url: str
    label: str
    folder: str


class CollectionBody(BaseModel):
    site: str
    user: str
    items: list[CollectionItem] = Field(max_length=20)
    thumb: str | None = None
    only: str | None = None


class SiteBody(BaseModel):
    site: str


class CollectBody(BaseModel):
    on: bool = True
    limit: int = 500


class ThemeBody(BaseModel):
    theme: str


class SelectionBody(BaseModel):
    ids: list[str] | None = None
    items: list[dict] | None = None


class OpenBody(BaseModel):
    job_id: str | None = None
    target: str = "file"  # file | folder | root | repo


LEGAL = {"terms": "TERMS.md", "privacy": "PRIVACY.md", "notices": "THIRD-PARTY-NOTICES.md"}


def create_app(token: str, pick_folder: Callable[[str], str | None], quit_app: Callable[[], None]) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        bus.bind(asyncio.get_running_loop())
        yield

    app = FastAPI(title="CuteTube", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        # Only the app window (which received the token at launch) may call the API.
        host = (request.headers.get("host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            return JSONResponse({"detail": "Bad host"}, status_code=403)
        if request.url.path.startswith("/api/"):
            if not hmac.compare_digest(request.headers.get("x-ct-token", ""), token):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)

    def snapshot() -> dict:
        return {
            "version": __version__,
            "terms_version": TERMS_VERSION,
            "repo": REPO_URL,
            "settings": settings.all(),
            "tools": tools.snapshot(),
            "jobs": downloader.snapshot(),
            "browser": pane.state(),
            "selection": pane.selection_state(),
            "downloaded": archive.all_ids(),
        }

    # -- state + events -------------------------------------------------------
    @app.get("/api/state")
    def get_state():
        return snapshot()

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        if not hmac.compare_digest(socket.query_params.get("token", ""), token):
            await socket.close(code=4401)
            return
        await socket.accept()
        q = bus.subscribe()
        try:
            await socket.send_json({"type": "snapshot", "data": await asyncio.to_thread(snapshot)})
            while True:
                msg = await q.get()
                await socket.send_json(msg)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            bus.unsubscribe(q)

    # -- browser pane ---------------------------------------------------------
    @app.post("/api/browser/nav")
    def browser_nav(body: NavBody):
        if body.action == "go":
            pane.navigate(body.url or "")
        else:
            pane.command(body.action)
        return {"ok": True}

    @app.post("/api/browser/layout")
    def browser_layout(body: LayoutBody):
        pane.set_layout(body.left, body.top, body.right, body.bottom, body.dpr, body.visible)
        return {"ok": True}

    @app.post("/api/browser/select-mode")
    def select_mode(body: ToggleBody):
        pane.set_select_mode(body.on)
        return {"ok": True}

    @app.post("/api/browser/select-all")
    def select_all():
        pane.select_all_visible()
        return {"ok": True}

    @app.post("/api/browser/site")
    def browser_site(body: SiteBody):
        try:
            pane.set_site(body.site)
        except ValueError as e:
            raise HTTPException(404, str(e))
        return {"ok": True}

    @app.post("/api/browser/collect")
    def browser_collect(body: CollectBody):
        pane.collect(body.on, body.limit)
        return {"ok": True}

    @app.post("/api/window/theme")
    def window_theme(body: ThemeBody):
        pane.style_titlebar("light" if body.theme == "light" else "dark")
        return {"ok": True}

    @app.post("/api/browser/clear-data")
    def clear_data():
        pane.clear_browsing_data()
        return {"ok": True}

    @app.post("/api/selection/remove")
    def selection_remove(body: SelectionBody):
        pane.clear_selection(body.ids)
        return {"ok": True}

    @app.post("/api/selection/add")
    def selection_add(body: SelectionBody):
        pane.add_to_selection(body.items or [])
        return {"ok": True}

    # -- resolving ------------------------------------------------------------
    @app.post("/api/resolve")
    def resolve(body: UrlBody):
        return classify(body.url)

    @app.get("/api/video")
    def get_video(url: str):
        try:
            return video_info(url)
        except Exception as e:
            raise HTTPException(422, clean_error(e))

    @app.get("/api/media")
    def get_media(url: str):
        from .social import media_info

        try:
            return media_info(url)
        except Exception as e:
            raise HTTPException(422, clean_error(e))

    @app.get("/api/social/profile")
    def social_profile(url: str):
        from .sites import SITES, profile_categories

        c = classify(url)
        if c.get("kind") != "profile":
            raise HTTPException(422, "Not a profile link")
        return {"site": c["site"], "user": c["user"], "label": SITES[c["site"]]["label"],
                "categories": profile_categories(c["site"], c["user"])}

    @app.post("/api/downloads/collections")
    def add_collections(body: CollectionBody):
        from .sites import classify_social

        added = 0
        for it in body.items:
            c = classify_social(it.url)
            if c.get("site") != body.site:
                raise HTTPException(422, "Link doesn't belong to this site")
            try:
                if downloader.add_collection(body.site, body.user, it.url, it.label, it.folder, body.thumb, body.only):
                    added += 1
            except ValueError as e:
                raise HTTPException(422, str(e))
        return {"added": added}

    @app.get("/api/channel")
    def get_channel(url: str):
        try:
            return channel_info(url)
        except Exception as e:
            raise HTTPException(422, clean_error(e))

    @app.post("/api/listing")
    def start_listing(body: ListingBody):
        try:
            return listings.start(body.url, body.tab, body.refresh).snapshot()
        except ValueError as e:
            raise HTTPException(422, str(e))

    # -- downloads ------------------------------------------------------------
    @app.post("/api/downloads")
    def add_downloads(body: DownloadBody):
        try:
            jobs = downloader.add([i.model_dump() for i in body.items], body.preset, body.folder, body.skip_existing,
                                  body.only)
        except ValueError as e:
            raise HTTPException(422, str(e))
        return {"added": len(jobs), "jobs": jobs}

    @app.post("/api/downloads/playlists")
    def add_playlists(body: PlaylistDownloadBody):
        started = 0
        for item in body.items:
            try:
                downloader.add_playlist(item.url, body.preset, body.skip_existing, item.title)
                started += 1
            except ValueError as e:
                raise HTTPException(422, str(e))
        return {"started": started}

    @app.post("/api/downloads/batch")
    def batch(body: BatchBody):
        try:
            return {"changed": downloader.batch(body.ids, body.action)}
        except ValueError:
            raise HTTPException(404, "Unknown action")

    @app.post("/api/downloads/bulk/{action}")
    def bulk(action: str):
        if action not in ("pause_all", "resume_all", "retry_failed", "clear_finished"):
            raise HTTPException(404)
        downloader.bulk(action)
        return {"ok": True}

    @app.post("/api/downloads/{job_id}/{action}")
    def job_action(job_id: str, action: str):
        if action not in ("pause", "resume", "cancel", "retry", "remove"):
            raise HTTPException(404)
        try:
            downloader.action(job_id, action)
        except KeyError:
            raise HTTPException(404, "Job not found")
        return {"ok": True}

    @app.post("/api/open")
    def open_target(body: OpenBody):
        if body.target == "repo":
            import webbrowser

            webbrowser.open(REPO_URL)
            return {"ok": True}
        if body.target == "root":
            root = Path(settings["download_dir"])
            root.mkdir(parents=True, exist_ok=True)
            open_path(str(root))
            return {"ok": True}
        job = downloader.jobs.get(body.job_id or "")
        if not job:
            raise HTTPException(404, "Job not found")
        path = job.filepath if job.filepath and os.path.exists(job.filepath) else job.dir
        if not path or not os.path.exists(path):
            raise HTTPException(404, "File no longer exists")
        open_path(path, reveal=body.target == "folder")
        return {"ok": True}

    # -- legal ------------------------------------------------------------------
    @app.get("/api/legal/{doc}")
    def legal(doc: str):
        path = LICENSE_FILE if doc == "license" else LEGAL_DIR / LEGAL.get(doc, "")
        if doc != "license" and doc not in LEGAL or not path.is_file():
            raise HTTPException(404, "Not found")
        return {"text": path.read_text("utf-8")}

    @app.post("/api/quit")
    def quit_():
        quit_app()
        return {"ok": True}

    # -- settings + tools -----------------------------------------------------
    @app.get("/api/settings")
    def get_settings():
        return settings.all()

    @app.patch("/api/settings")
    def patch_settings(patch: dict[str, Any]):
        before = settings.all()
        after = settings.update(patch)
        if after["concurrency"] != before["concurrency"]:
            downloader.kick()
        if after["adblock"] != before["adblock"]:
            pane.set_adblock(after["adblock"])
        bus.publish("settings", after)
        return after

    @app.post("/api/settings/pick-folder")
    def pick_folder_route():
        path = pick_folder(settings["download_dir"])
        if path:
            after = settings.update({"download_dir": path})
            bus.publish("settings", after)
        return {"path": path}

    @app.post("/api/tools/retry")
    def tools_retry():
        tools.retry()
        return {"ok": True}

    @app.post("/api/tools/update-ytdlp")
    def tools_update():
        tools.update_ytdlp()
        return {"ok": True}

    @app.post("/api/adblock/refresh")
    def adblock_refresh():
        import threading

        threading.Thread(target=adblocker.refresh, daemon=True).start()
        return {"ok": True}

    @app.get("/api/clipboard")
    def clipboard():
        return {"text": pane.read_clipboard()[:4000]}

    if FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app
