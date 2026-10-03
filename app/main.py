"""Entry point: start the local API, then open the desktop window with the YouTube pane."""
from __future__ import annotations

import logging
import os
import secrets
import socket
import threading
import time

import uvicorn
import webview

from . import APP_NAME, ytdl
from .browser.adblock_engine import adblocker
from .browser.pane import pane, refresh_cookies_if_needed, site_cookies
from .config import CDP, DEV, FRONTEND_DIST, PROFILE_MAIN, settings
from .downloader import downloader
from .server import create_app
from .tools import tools
from .window import ICON, set_app_id

DEV_PORT = 8765
VITE_URL = "http://localhost:5173"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_port(port: int, timeout: float = 15) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.05)
    raise RuntimeError("API server did not start")


def main() -> None:
    logging.basicConfig(level=logging.INFO if DEV else logging.WARNING)
    token = os.environ.get("CUTETUBE_TOKEN") if DEV else None
    token = token or secrets.token_urlsafe(24)
    port = DEV_PORT if DEV else _free_port()

    set_app_id()
    tools.ensure_all()
    if settings["auto_update"]:
        tools.auto_update()
    adblocker.load_async()
    ytdl.cookie_hook = refresh_cookies_if_needed
    ytdl.social_cookie_hook = site_cookies
    downloader.on_downloaded = pane.mark_downloaded

    window: webview.Window | None = None

    def pick_folder(start: str) -> str | None:
        if window is None:
            return None
        res = window.create_file_dialog(webview.FileDialog.FOLDER, directory=start)
        return res[0] if res else None

    def quit_app() -> None:
        if window is not None:
            threading.Thread(target=window.destroy, daemon=True).start()

    app = create_app(token, pick_folder, quit_app)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", ws="websockets-sansio"))
    threading.Thread(target=server.run, daemon=True, name="api").start()
    _wait_port(port)

    if CDP:
        webview.settings["REMOTE_DEBUGGING_PORT"] = 9222
    if DEV:
        url = f"{VITE_URL}/?token={token}"
    else:
        if not FRONTEND_DIST.exists():
            raise SystemExit("Frontend not built. Run: cd frontend && npm install && npm run build")
        url = f"http://127.0.0.1:{port}/?token={token}"

    window = webview.create_window(
        "Cutetube", url, width=1440, height=900, min_size=(1100, 680), background_color="#120d24",
    )

    def on_closing() -> None:
        downloader.shutdown()

    window.events.closing += on_closing
    webview.start(pane.attach, window, gui="edgechromium", private_mode=False,
                  storage_path=str(PROFILE_MAIN), debug=DEV, icon=str(ICON))
    server.should_exit = True


if __name__ == "__main__":
    main()
