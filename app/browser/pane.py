"""Embedded site browsers: one native WebView2 per site tab (YouTube, Facebook, Instagram, TikTok),
layered over the React UI. Only the active tab's view is visible.

React reports the rectangle it reserves for the browser (as insets from the window edges) and Python
keeps the native control positioned there. All WebView2 calls must happen on the WinForms UI thread.
All panes share one browser profile, so a login done in any tab is kept across restarts.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import webbrowser
from collections import OrderedDict
from typing import Any, Callable

from ..config import CDP, COOKIES_FILE, DATA_DIR, INJECT_DIR, PROFILE_YT, settings
from ..downloader import archive
from ..events import bus
from ..resolver import PLAYLIST_ID, VIDEO_ID, classify, playlist_url
from ..sites import ALLOWED_NAV, SITES, host_of, search_url, site_of
from .adblock_engine import adblocker

log = logging.getLogger("cutetube.pane")

COOKIE_DIR = DATA_DIR / "cookies"
COOKIE_DIR.mkdir(exist_ok=True)
COOKIE_DOMAINS = {
    "youtube": r"youtube\.com|google\.com",
    "facebook": r"facebook\.com",
    "instagram": r"instagram\.com",
    "tiktok": r"tiktok\.com",
}


def _home(site: str) -> str:
    return settings["home_url"] if site == "youtube" else SITES[site]["home"]


class SitePane:
    """One site's WebView2. Owned by the Browsers manager; UI-thread only unless noted."""

    def __init__(self, mgr: "Browsers", site: str) -> None:
        self.mgr = mgr
        self.site = site
        self.view: Any = None
        self.core: Any = None
        self.ready = threading.Event()
        self._script_id_task: Any = None
        self._main_nav: str | None = None
        self.loading = False
        # Cached on the UI thread; other threads must never touch WebView2 objects
        # (a cross-thread COM property read blocks while holding the GIL and deadlocks the app).
        self.nav: dict[str, Any] = {"url": "", "title": "", "canBack": False, "canForward": False}
        self.page: dict[str, Any] = {}
        self.blocked_page = 0

    # -- creation -----------------------------------------------------------
    def create(self, initial_url: str | None = None) -> None:
        from Microsoft.Web.WebView2.WinForms import CoreWebView2CreationProperties, WebView2
        from System.Drawing import Color

        view = WebView2()
        props = CoreWebView2CreationProperties()
        props.UserDataFolder = str(PROFILE_YT)  # shared profile: identical options are required
        props.AdditionalBrowserArguments = _browser_args()
        view.CreationProperties = props
        view.DefaultBackgroundColor = Color.FromArgb(255, 18, 13, 36)
        view.Visible = False
        self.mgr.form.Controls.Add(view)
        view.BringToFront()
        self._initial = initial_url or _home(self.site)
        view.CoreWebView2InitializationCompleted += self._on_ready
        self.view = view
        view.EnsureCoreWebView2Async(None)

    def script(self) -> str:
        name = "youtube.js" if self.site == "youtube" else "social.js"
        src = (INJECT_DIR / name).read_text("utf-8")
        prefix = SITES[self.site]["prefix"]
        ids = [i for i in archive.all_ids() if (i.startswith(prefix) if prefix else ":" not in i)]
        cfg = {"site": self.site, "adblock": bool(settings["adblock"]), "downloaded": ids[-20000:]}
        return src.replace("__CT_CONFIG__", json.dumps(cfg))

    def _on_ready(self, sender, args) -> None:
        if not args.IsSuccess:
            log.error("%s WebView2 failed: %s", self.site, args.InitializationException)
            bus.toast(f"Couldn't start the {SITES[self.site]['label']} browser (WebView2).", "error")
            return
        from Microsoft.Web.WebView2.Core import CoreWebView2WebResourceContext

        core = sender.CoreWebView2
        self.core = core
        s = core.Settings
        s.AreDevToolsEnabled = CDP
        s.IsStatusBarEnabled = False
        s.AreDefaultContextMenusEnabled = True
        s.AreBrowserAcceleratorKeysEnabled = True
        s.IsZoomControlEnabled = True
        s.IsSwipeNavigationEnabled = False

        self._script_id_task = core.AddScriptToExecuteOnDocumentCreatedAsync(self.script())
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All)
        core.WebResourceRequested += self._on_request
        core.NavigationStarting += self._on_nav_start
        core.NavigationCompleted += self._on_nav_done
        core.SourceChanged += lambda s, e: self.nav_changed()
        core.HistoryChanged += lambda s, e: self.nav_changed()
        core.DocumentTitleChanged += lambda s, e: self.nav_changed()
        core.NewWindowRequested += self._on_new_window
        core.WebMessageReceived += self._on_message
        core.ContextMenuRequested += self._on_context_menu
        core.ContainsFullScreenElementChanged += lambda s, e: self.mgr.on_fullscreen(self)
        core.Navigate(self._initial)
        self.ready.set()

    # -- network: ad blocking + navigation policy -------------------------------
    def _on_request(self, sender, args) -> None:
        if not settings["adblock"]:
            return
        try:
            uri = args.Request.Uri
            ctx = str(args.ResourceContext)
            if ctx == "Document" and uri == self._main_nav:
                return
            if adblocker.should_block(uri, self.page.get("url") or _home(self.site), ctx):
                args.Response = self.core.Environment.CreateWebResourceResponse(None, 403, "Blocked", "")
                self.blocked_page += 1
                self.mgr.blocked_total += 1
                if self.site == self.mgr.active:
                    bus.publish("adblock", self.mgr.adblock_stats(), throttle_key="adblock", interval=1.0)
        except Exception:
            log.exception("request filter failed")

    def _on_nav_start(self, sender, args) -> None:
        uri = str(args.Uri)
        if uri.startswith(("about:", "data:", "blob:")):
            return
        if not ALLOWED_NAV.search(host_of(uri)):
            args.Cancel = True
            webbrowser.open(uri)
            bus.toast("Opened external link in your browser.")
            return
        other = site_of(uri)
        if other and other != self.site and args.IsUserInitiated:
            # A link to another supported site opens in that site's tab.
            args.Cancel = True
            self.mgr.open_in_site(other, uri)
            return
        self._main_nav = uri
        self.loading = True
        self.blocked_page = 0
        self.nav_changed()

    def _on_nav_done(self, sender, args) -> None:
        self.loading = False
        self.nav_changed()

    def _on_new_window(self, sender, args) -> None:
        args.Handled = True
        uri = str(args.Uri)
        other = site_of(uri)
        if other == self.site:
            self.core.Navigate(uri)
        elif other:
            self.mgr.open_in_site(other, uri)
        elif ALLOWED_NAV.search(host_of(uri)):
            self.core.Navigate(uri)  # e.g. Google / Apple login popups
        elif uri.startswith("http"):
            webbrowser.open(uri)

    # -- messages from the injected script ------------------------------------
    def post(self, msg: dict) -> None:
        def run() -> None:
            if self.core is not None:
                self.core.PostWebMessageAsJson(json.dumps(msg))

        self.mgr.ui(run)

    def _on_message(self, sender, args) -> None:
        if site_of(str(args.Source)) != self.site:
            return
        try:
            msg = json.loads(args.WebMessageAsJson)
        except ValueError:
            return
        if not isinstance(msg, dict):
            return
        mgr = self.mgr
        kind = msg.get("type")
        if kind == "ready":
            url = str(msg.get("url") or _home(self.site))
            if settings["adblock"]:
                self.post({"type": "css", "css": adblocker.cosmetic_css(url)})
            self.post({"type": "selectMode", "on": mgr.select_mode})
            self.post({"type": "selection", "ids": list(mgr.selection)})
        elif kind == "page":
            video = msg.get("video") if isinstance(msg.get("video"), dict) else None
            self.page = {"url": str(msg.get("url") or "")[:2000], "title": str(msg.get("title") or "")[:300],
                         "video": video, "profile": msg.get("profile") if isinstance(msg.get("profile"), dict) else None,
                         "signedIn": msg.get("signedIn") if isinstance(msg.get("signedIn"), bool) else None}
            if self.site == mgr.active:
                mgr.emit_state()
        elif kind == "toggle":
            item = mgr.clean_item(self.site, msg.get("item"))
            if item:
                if msg.get("on"):
                    mgr.selection[item["id"]] = item
                else:
                    mgr.selection.pop(item["id"], None)
                mgr.emit_selection(echo=False)
        elif kind == "addMany":
            for raw in (msg.get("items") or [])[:5000]:
                item = mgr.clean_item(self.site, raw)
                if item:
                    mgr.selection.setdefault(item["id"], item)
            mgr.emit_selection(echo=False)
        elif kind == "collect":
            bus.publish("collect", {"site": self.site, "count": int(msg.get("count") or 0), "done": bool(msg.get("done"))})
        elif kind == "pruned":
            mgr.ads_skipped += int(msg.get("n") or 0)
            bus.publish("adblock", mgr.adblock_stats())
        elif kind == "adSkipped":
            mgr.ads_skipped += 1
            bus.publish("adblock", mgr.adblock_stats())
        elif kind == "exitSelect":
            mgr.set_select_mode(False)

    # -- right-click menu -------------------------------------------------------
    def _on_context_menu(self, sender, args) -> None:
        from Microsoft.Web.WebView2.Core import CoreWebView2ContextMenuItemKind

        target = args.ContextMenuTarget
        link = str(target.LinkUri) if target.HasLinkUri else str(target.PageUri)
        c = classify(link)
        if c["kind"] not in ("video", "media"):
            return
        env = self.core.Environment
        preset = settings["default_preset"]
        video_preset = preset if preset not in ("mp3", "m4a") else "1080"
        title = str(target.LinkText).strip() if target.HasLinkUri and target.LinkText else None
        item = {"url": c["url"], "title": title}

        def make(text: str, fn: Callable[[], None]):
            mi = env.CreateContextMenuItem(text, None, CoreWebView2ContextMenuItemKind.Command)
            mi.CustomItemSelected += lambda s, e: threading.Thread(target=fn, daemon=True).start()
            return mi

        from ..downloader import downloader

        def dl(p: str) -> None:
            try:
                jobs = downloader.add([item], p, {"mode": "auto"}, skip_existing=False)
                bus.toast("Added to downloads" if jobs else "Already in your queue", "success" if jobs else "info")
            except ValueError as e:
                bus.toast(str(e), "error")

        def add_sel() -> None:
            raw = {"id": c.get("video_id"), "title": title, "short": c.get("short")} if c["kind"] == "video" \
                else {"url": c["url"], "title": title}
            it = self.mgr.clean_item(self.site if c["kind"] == "media" else "youtube", raw)
            if it:
                self.mgr.selection.setdefault(it["id"], it)
                self.mgr.emit_selection()

        if c["kind"] == "video":
            label = "best quality" if video_preset == "best" else f"{video_preset}p"
            entries = [make(f"Download video ({label})", lambda: dl(video_preset))]
        else:
            entries = [make("Download with Cutetube", lambda: dl(video_preset))]
        entries += [
            make("Download audio (MP3)", lambda: dl("mp3")),
            make("Add to Cutetube selection", add_sel),
            env.CreateContextMenuItem("", None, CoreWebView2ContextMenuItemKind.Separator),
        ]
        for i, mi in enumerate(entries):
            args.MenuItems.Insert(i, mi)

    # -- state ------------------------------------------------------------------
    def nav_changed(self) -> None:
        """UI thread only: refresh the cached navigation state and broadcast it."""
        c = self.core
        if c is not None:
            try:
                self.nav = {"url": str(c.Source), "title": str(c.DocumentTitle),
                            "canBack": bool(c.CanGoBack), "canForward": bool(c.CanGoForward)}
            except Exception:
                log.exception("reading navigation state failed")
        if self.site == self.mgr.active:
            self.mgr.emit_state()

    def state(self) -> dict:
        """Safe from any thread: only reads cached values."""
        url = self.nav["url"] or self.page.get("url") or ""
        video = self.page.get("video")
        ctx = classify(url) if url else {"kind": "page", "page": "home", "site": self.site}
        if video and ctx.get("video_id") != video.get("id"):
            video = None
        title = re.sub(r"\s*[-|•]\s*(YouTube|Facebook|Instagram|TikTok)$", "", self.nav["title"])
        return {
            "site": self.site, "ready": self.ready.is_set(), "url": url, "title": title, "loading": self.loading,
            "canBack": self.nav["canBack"], "canForward": self.nav["canForward"], "ctx": ctx, "video": video,
            "profile": self.page.get("profile") if ctx.get("kind") == "profile" else None,
            "signedIn": self.page.get("signedIn"),
        }


class Resolver:
    """An off-screen WebView2 on the shared (logged-in) profile. Opens a page and reads what the site rendered
    there, for content the download tools can't parse reliably (Facebook posts and photo sets)."""

    def __init__(self, mgr: "Browsers") -> None:
        self.mgr = mgr
        self.view: Any = None
        self.core: Any = None
        self.ready = threading.Event()
        self.loaded = threading.Event()
        self.lock = threading.Lock()
        self.capturing = False
        self.captured: list[tuple[str, str]] = []  # (url, content type) of media the page streamed

    def _create(self) -> None:
        from Microsoft.Web.WebView2.WinForms import CoreWebView2CreationProperties, WebView2
        from System.Drawing import Point, Size

        view = WebView2()
        props = CoreWebView2CreationProperties()
        props.UserDataFolder = str(PROFILE_YT)
        props.AdditionalBrowserArguments = _browser_args()
        view.CreationProperties = props
        # Visible but outside the window, so the page renders and lazy content loads as it would on screen.
        view.Location = Point(-30000, -30000)
        view.Size = Size(1100, 1600)
        self.mgr.form.Controls.Add(view)
        view.CoreWebView2InitializationCompleted += self._on_ready
        self.view = view
        view.EnsureCoreWebView2Async(None)

    def _on_ready(self, sender, args) -> None:
        if not args.IsSuccess:
            log.error("resolver WebView2 failed: %s", args.InitializationException)
            return
        core = sender.CoreWebView2
        self.core = core
        try:
            core.IsMuted = True
        except Exception:
            pass
        core.Settings.AreDevToolsEnabled = CDP
        core.NavigationStarting += self._on_nav_start
        core.NavigationCompleted += lambda s, e: self.loaded.set()
        core.NewWindowRequested += lambda s, e: setattr(e, "Handled", True)
        core.WebResourceResponseReceived += self._on_response
        # Players often fetch their streams from a worker: ask for those requests too where the runtime can.
        from Microsoft.Web.WebView2.Core import CoreWebView2WebResourceContext

        try:
            from Microsoft.Web.WebView2.Core import CoreWebView2WebResourceRequestSourceKinds

            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All,
                                               CoreWebView2WebResourceRequestSourceKinds.All)
        except Exception:
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All)
        core.WebResourceRequested += self._on_request
        self.ready.set()

    def _on_request(self, sender, args) -> None:
        if not self.capturing:
            return
        try:
            uri = str(args.Request.Uri)
            if re.search(r"\.(mp4|m4a|webm)(\?|$)|[?&]bytestart=", uri):
                self.captured.append((uri, ""))
        except Exception:
            pass

    def _on_response(self, sender, args) -> None:
        """UI thread: remember audio / video responses (the streams behind blob: players)."""
        if not self.capturing:
            return
        try:
            uri = str(args.Request.Uri)
            headers = args.Response.Headers
            ctype = str(headers.GetHeader("Content-Type")) if headers.Contains("Content-Type") else ""
            if ctype.startswith(("video/", "audio/")) or re.search(r"\.(mp4|m4a|webm)(\?|$)", uri):
                self.captured.append((uri, ctype))
        except Exception:
            pass

    @staticmethod
    def _on_nav_start(sender, args) -> None:
        uri = str(args.Uri)
        if not uri.startswith(("about:", "data:")) and not ALLOWED_NAV.search(host_of(uri)):
            args.Cancel = True

    def _navigate(self, url: str, timeout: float) -> bool:
        self.loaded.clear()
        self.mgr.ui(lambda: self.core.Navigate(url))
        return self.loaded.wait(timeout)

    def _eval(self, js: str, timeout: float = 10) -> Any:
        from System import Action
        from System.Threading.Tasks import Task

        done = threading.Event()
        out: dict[str, Any] = {}

        def on_result(task) -> None:
            try:
                out["v"] = str(task.Result)  # a JSON string: plain .NET data, safe off the UI thread
            except Exception as e:
                out["e"] = e
            finally:
                done.set()

        self.mgr.ui(lambda: self.core.ExecuteScriptAsync(js).ContinueWith(Action[Task[str]](on_result)))
        if not done.wait(timeout) or "v" not in out:
            return None
        try:
            return json.loads(out["v"])
        except ValueError:
            return None

    def run(self, url: str, script: str, settle: Callable[[list[dict]], bool], scroll: bool = False,
            timeout: float = 30, capture: bool = False) -> dict | None:
        """Open `url`, then poll `script` until `settle(results)` says the page is complete. Thread-safe.
        With `capture`, the result also lists the media streams the page fetched (`streams`)."""
        if self.mgr.form is None:
            return None
        with self.lock:
            if self.view is None:
                self.mgr.ui(self._create)
            if not self.ready.wait(30):
                return None
            try:
                self.captured = []
                self.capturing = capture
                deadline = time.time() + timeout
                self._navigate(url, 20)
                results: list[dict] = []
                while time.time() < deadline:
                    time.sleep(0.8)
                    r = self._eval(script)
                    if not isinstance(r, dict):
                        continue
                    results.append(r)
                    if r.get("login") or settle(results):
                        break
                    if scroll:
                        self._eval("window.scrollBy(0, 2400); 1")
                if not results:
                    return None
                out = dict(results[-1])
                if capture:
                    out["streams"] = list(self.captured)
                return out
            finally:
                self.capturing = False
                self.mgr.ui(lambda: self.core.Navigate("about:blank"))  # stop videos, free the page


def _browser_args() -> str:
    """Every WebView2 on the shared profile must be created with identical arguments."""
    args = "--disable-features=ElasticOverscroll --autoplay-policy=no-user-gesture-required"
    # Hardware video overlays can stop updating when the view sits inside another window (and on PCs with two
    # GPUs): the picture freezes while the sound plays on. Draw video through the normal compositor instead.
    args += " --disable-direct-composition-video-overlays"
    if CDP:
        args += " --remote-debugging-port=9223"
    return args


class Browsers:
    """Manages the per-site panes, layout, the shared selection and the commands from React."""

    def __init__(self) -> None:
        self.form: Any = None
        self.panes: dict[str, SitePane] = {}
        self.active = "youtube"
        self.insets = (0.0, 0.0, 0.0, 0.0)
        self.dpr = 1.0
        self.visible = False
        self.fullscreen: SitePane | None = None
        self._pre_fullscreen: tuple | None = None
        self.select_mode = False
        self.selection: "OrderedDict[str, dict]" = OrderedDict()
        self.blocked_total = 0
        self.ads_skipped = 0
        self.resolver = Resolver(self)

    # -- threading ----------------------------------------------------------------
    def ui(self, fn: Callable[[], Any], wait: bool = False) -> Any:
        """Run `fn` on the UI thread. With wait=True, block and return its result."""
        from System import Action

        if self.form is None:
            return None
        result: dict[str, Any] = {}

        def run() -> None:
            try:
                result["v"] = fn()
            except Exception as e:  # never let an exception escape into the WinForms loop
                log.exception("UI call failed")
                result["e"] = e

        if not self.form.InvokeRequired:
            run()
        elif wait:
            self.form.Invoke(Action(run))
        else:
            self.form.BeginInvoke(Action(run))
            return None
        return result.get("v")

    @property
    def ready(self) -> threading.Event:
        return self.pane().ready

    def pane(self, site: str | None = None) -> SitePane:
        site = site or self.active
        if site not in self.panes:
            self.panes[site] = SitePane(self, site)
        return self.panes[site]

    def _ensure_created(self, site: str, url: str | None = None) -> SitePane:
        p = self.pane(site)
        if p.view is None and self.form is not None:
            p.create(url)
        return p

    # -- window ---------------------------------------------------------------------
    def attach(self, window) -> None:
        window.events.shown.wait(30)
        self.form = window.native

        def init() -> None:
            self._ensure_created("youtube")
            self.form.Resize += lambda s, e: self.apply_layout()
            self.apply_layout()

        self.ui(init)
        theme = settings["theme"]
        self.style_titlebar("light" if theme == "light" else "dark")

    def style_titlebar(self, theme: str) -> None:
        from ..window import style_titlebar

        hwnd = self.ui(lambda: int(self.form.Handle.ToInt64()), wait=True)
        if hwnd:
            style_titlebar(hwnd, theme)

    def set_layout(self, left: float, top: float, right: float, bottom: float, dpr: float, visible: bool) -> None:
        self.insets = (left, top, right, bottom)
        self.dpr = dpr if 0.5 <= dpr <= 5 else 1.0
        self.visible = visible
        self.ui(self.apply_layout)

    def apply_layout(self) -> None:
        if self.form is None:
            return
        cs = self.form.ClientSize
        l, t, r, b = (int(round(v * self.dpr)) for v in self.insets)
        w, h = max(0, cs.Width - l - r), max(0, cs.Height - t - b)
        for site, p in self.panes.items():
            if p.view is None:
                continue
            if self.fullscreen is p:
                p.view.SetBounds(0, 0, cs.Width, cs.Height)
                p.view.Visible = True
                p.view.BringToFront()
            elif site == self.active:
                p.view.SetBounds(l, t, w, h)
                p.view.Visible = bool(self.visible and w > 40 and h > 40)
                p.view.BringToFront()
            else:
                p.view.Visible = False

    def on_fullscreen(self, p: SitePane) -> None:
        import System.Windows.Forms as WinForms

        fs = bool(p.core.ContainsFullScreenElement)
        f = self.form
        if fs and self.fullscreen is None:
            self._pre_fullscreen = (f.FormBorderStyle, f.WindowState)
            f.FormBorderStyle = getattr(WinForms.FormBorderStyle, "None")
            f.WindowState = WinForms.FormWindowState.Normal
            f.WindowState = WinForms.FormWindowState.Maximized
            self.fullscreen = p
        elif not fs and self.fullscreen is p:
            self.fullscreen = None
            if self._pre_fullscreen:
                f.FormBorderStyle, state = self._pre_fullscreen
                f.WindowState = state
        self.apply_layout()

    # -- tabs -------------------------------------------------------------------------
    def set_site(self, site: str) -> None:
        if site not in SITES:
            raise ValueError("Unknown site")
        self.active = site

        def run() -> None:
            self._ensure_created(site)
            self.apply_layout()
            p = self.pane(site)
            p.post({"type": "selectMode", "on": self.select_mode})
            p.post({"type": "selection", "ids": list(self.selection)})

        self.ui(run)
        self.emit_state()

    def open_in_site(self, site: str, url: str) -> None:
        """Called on the UI thread from a pane: show `url` in another site's tab."""
        self.active = site
        p = self.pane(site)
        if p.view is None:
            p.create(url)
        elif p.core is not None:
            p.core.Navigate(url)
        self.apply_layout()
        self.emit_state()

    # -- state ----------------------------------------------------------------------------
    def adblock_stats(self) -> dict:
        return {"enabled": bool(settings["adblock"]), "page": self.pane().blocked_page, "total": self.blocked_total,
                "ads": self.ads_skipped, "full": adblocker.full}

    def state(self) -> dict:
        s = self.pane().state()
        s.update({"selectMode": self.select_mode, "adblock": self.adblock_stats(),
                  "sites": {k: {"label": v["label"], "open": k in self.panes} for k, v in SITES.items()}})
        return s

    def emit_state(self) -> None:
        bus.publish("browser", self.state())

    def selection_state(self) -> dict:
        return {"items": list(self.selection.values()), "selectMode": self.select_mode}

    def emit_selection(self, echo: bool = True) -> None:
        bus.publish("selection", self.selection_state())
        if echo:
            for p in self.panes.values():
                p.post({"type": "selection", "ids": list(self.selection)})

    # -- selection items -------------------------------------------------------------------
    @staticmethod
    def clean_item(site: str, raw: Any) -> dict | None:
        if not isinstance(raw, dict):
            return None
        if site != "youtube":
            url = str(raw.get("url") or "")
            c = classify(url)
            if c.get("kind") != "media" or c.get("site") != site:
                return None
            thumb = str(raw.get("thumb") or "")
            return {
                "id": c["id"], "kind": "media", "site": site, "media_type": raw.get("media_type") or c["media_type"],
                "url": c["url"], "title": str(raw.get("title") or "")[:300] or None,
                "channel": str(raw.get("author") or c.get("author") or "")[:120] or None,
                "duration": raw.get("duration") if isinstance(raw.get("duration"), (int, float)) else None,
                "short": False, "thumb": thumb if thumb.startswith("https://") else None,
            }
        if raw.get("kind") in ("playlist", "mix"):
            list_id = str(raw.get("list_id") or "")
            vid = str(raw.get("video_id") or "")
            vid = vid if VIDEO_ID.match(vid) else None
            if not PLAYLIST_ID.match(list_id) or (list_id.startswith("RD") and not vid):
                return None  # a mix only exists relative to its seed video
            thumb = str(raw.get("thumb") or "")
            count = raw.get("count")
            return {
                "id": f"pl:{list_id}", "kind": "mix" if list_id.startswith("RD") else "playlist", "site": "youtube",
                "list_id": list_id, "url": playlist_url(list_id, vid),
                "title": str(raw.get("title") or "")[:300] or None,
                "channel": str(raw.get("channel") or "")[:120] or None,
                "count": count if isinstance(count, int) and count > 0 else None,
                "duration": None, "short": False,
                "thumb": thumb if thumb.startswith("https://i.ytimg.com/") else
                (f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg" if vid else None),
            }
        if not VIDEO_ID.match(str(raw.get("id") or "")):
            return None
        vid = raw["id"]
        short = bool(raw.get("short"))
        dur = raw.get("duration")
        return {
            "id": vid, "kind": "video", "site": "youtube",
            "url": f"https://www.youtube.com/{'shorts/' if short else 'watch?v='}{vid}",
            "title": str(raw.get("title") or "")[:300] or None,
            "channel": str(raw.get("channel") or "")[:120] or None,
            "duration": dur if isinstance(dur, (int, float)) else None,
            "short": short, "thumb": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
        }

    # -- commands from React ------------------------------------------------------------------
    def navigate(self, target: str) -> None:
        target = (target or "").strip()
        if not target:
            return
        full = target if "://" in target else "https://" + target
        site = site_of(full) if re.match(r"^(https?://)?[\w-]+(\.[\w-]+)+(/|$)", target) else None
        if site:
            self.ui(lambda: self.open_in_site(site, full))
            return
        if re.match(r"^[\w-]+(\.[\w-]+)+(/|$)", target) or target.startswith("http"):
            webbrowser.open(full)
            return
        url = search_url(self.active, target)
        self.ui(lambda: self.pane().core and self.pane().core.Navigate(url))

    def command(self, action: str) -> None:
        def run() -> None:
            c = self.pane().core
            if c is None:
                return
            if action == "back" and c.CanGoBack:
                c.GoBack()
            elif action == "forward" and c.CanGoForward:
                c.GoForward()
            elif action == "reload":
                c.Reload()
            elif action == "stop":
                c.Stop()
            elif action == "home":
                c.Navigate(_home(self.active))

        self.ui(run)

    def set_select_mode(self, on: bool) -> None:
        self.select_mode = bool(on)
        for p in self.panes.values():
            p.post({"type": "selectMode", "on": self.select_mode})
        bus.publish("selection", self.selection_state())
        self.emit_state()

    def select_all_visible(self) -> None:
        if not self.select_mode:
            self.set_select_mode(True)
        self.pane().post({"type": "selectAll"})

    def collect(self, on: bool, limit: int = 500) -> None:
        """Scroll the active page to load more posts, selecting everything found (social tabs)."""
        if on and not self.select_mode:
            self.set_select_mode(True)
        self.pane().post({"type": "collect", "on": bool(on), "limit": max(10, min(5000, int(limit)))})

    def clear_selection(self, ids: list[str] | None = None) -> None:
        if ids is None:
            self.selection.clear()
        else:
            for i in ids:
                self.selection.pop(i, None)
        self.emit_selection()

    def add_to_selection(self, items: list[dict]) -> None:
        for raw in items:
            site = raw.get("site") or site_of(str(raw.get("url") or "")) or "youtube"
            item = self.clean_item(site, raw)
            if item:
                self.selection.setdefault(item["id"], item)
        self.emit_selection()

    def mark_downloaded(self, vid: str) -> None:
        site = next((k for k, v in SITES.items() if v["prefix"] and vid.startswith(v["prefix"])), "youtube")
        if site in self.panes:
            self.panes[site].post({"type": "downloaded", "ids": [vid]})

    def set_adblock(self, enabled: bool) -> None:
        def run() -> None:
            for p in self.panes.values():
                c = p.core
                if c is None:
                    continue
                t = p._script_id_task
                if t is not None and t.IsCompleted:
                    c.RemoveScriptToExecuteOnDocumentCreated(t.Result)
                p._script_id_task = c.AddScriptToExecuteOnDocumentCreatedAsync(p.script())
                c.Reload()

        self.ui(run)
        self.emit_state()

    def read_clipboard(self) -> str:
        def run() -> str:
            import System.Windows.Forms as WinForms

            return str(WinForms.Clipboard.GetText()) if WinForms.Clipboard.ContainsText() else ""

        return self.ui(run, wait=True) or ""

    def clear_browsing_data(self) -> None:
        def run() -> None:
            c = self.pane().core
            if c is not None:
                c.CookieManager.DeleteAllCookies()  # shared profile: signs out of every site
            for s, p in self.panes.items():
                if p.core is not None:
                    p.core.Navigate(_home(s))

        self.ui(run)

    # -- cookies for yt-dlp / gallery-dl ----------------------------------------------------
    def export_cookies(self, site: str = "youtube", timeout: float = 10) -> str | None:
        """Write the browser's cookies for `site` as a Netscape cookies.txt. Returns the file path."""
        p = self.pane("youtube") if "youtube" in self.panes else next(iter(self.panes.values()), None)
        if p is None or not p.ready.wait(timeout):
            return None
        from Microsoft.Web.WebView2.Core import CoreWebView2Cookie
        from System import Action, DateTimeOffset
        from System.Collections.Generic import List
        from System.Threading.Tasks import Task

        done = threading.Event()
        rx = re.compile(rf"(^|\.)({COOKIE_DOMAINS[site]})$")
        lines = ["# Netscape HTTP Cookie File"]

        def read(task) -> None:
            # UI thread: cookie objects are COM wrappers, so turn them into plain strings here.
            try:
                for c in task.Result:
                    domain = str(c.Domain)
                    if not rx.search(domain.lstrip(".")):
                        continue
                    # Expires is a .NET DateTime in the WinForms wrapper.
                    expires = 0 if c.IsSession else int(DateTimeOffset(c.Expires.ToUniversalTime()).ToUnixTimeSeconds())
                    prefix = "#HttpOnly_" if c.IsHttpOnly else ""
                    lines.append("\t".join([
                        prefix + domain, "TRUE" if domain.startswith(".") else "FALSE", str(c.Path),
                        "TRUE" if c.IsSecure else "FALSE", str(max(expires, 0)), str(c.Name), str(c.Value),
                    ]))
            finally:
                done.set()

        def on_result(task) -> None:
            # Runs on a thread-pool thread; hop back to the UI thread before touching the cookies.
            self.ui(lambda: read(task))

        def start() -> None:
            p.core.CookieManager.GetCookiesAsync("").ContinueWith(Action[Task[List[CoreWebView2Cookie]]](on_result))

        self.ui(start)
        if not done.wait(timeout):
            return None
        path = COOKIES_FILE if site == "youtube" else COOKIE_DIR / f"{site}.txt"
        path.write_text("\n".join(lines) + "\n", "utf-8")
        return str(path)


pane = Browsers()

_last_export: dict[str, float] = {}


def refresh_cookies_if_needed() -> None:
    if settings["use_login_cookies"] and time.time() - _last_export.get("youtube", 0) > 600:
        if pane.export_cookies("youtube"):
            _last_export["youtube"] = time.time()


def site_cookies(site: str) -> str | None:
    """Fresh cookies.txt for a social site (these sites need your login for most content)."""
    path = COOKIE_DIR / f"{site}.txt"
    if time.time() - _last_export.get(site, 0) > 300 or not path.exists():
        if pane.export_cookies(site):
            _last_export[site] = time.time()
    return str(path) if path.exists() else None
