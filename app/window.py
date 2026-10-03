"""Native window chrome: brand icon and a title bar coloured like the app, so the window reads as one piece."""
from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes

from .config import ROOT

ICON = ROOT / "app" / "assets" / "cutetube.ico"

# Title bar colours per theme: same as the app's surface colour (rail + top bar) and text colour.
TITLEBAR = {
    "dark": {"caption": "#1A1431", "text": "#FFF6F2"},
    "light": {"caption": "#FFFFFF", "text": "#2E2250"},
}

_DWMWA_USE_IMMERSIVE_DARK_MODE = 20
_DWMWA_BORDER_COLOR = 34
_DWMWA_CAPTION_COLOR = 35
_DWMWA_TEXT_COLOR = 36


def set_app_id() -> None:
    """Group the window under its own taskbar entry with the Cutetube icon instead of Python's."""
    if sys.platform == "win32":
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Cutetube.App")


def _colorref(hex_color: str) -> int:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return r | (g << 8) | (b << 16)


def _set(hwnd: int, attr: int, value: int) -> None:
    fn = ctypes.windll.dwmapi.DwmSetWindowAttribute
    fn.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    v = ctypes.c_int(value)
    fn(hwnd, attr, ctypes.byref(v), ctypes.sizeof(v))


def style_titlebar(hwnd: int, theme: str) -> None:
    """Windows 11: paint caption, border and caption text in the app's colours (no-op on older Windows)."""
    if sys.platform != "win32" or not hwnd:
        return
    c = TITLEBAR["light" if theme == "light" else "dark"]
    _set(hwnd, _DWMWA_USE_IMMERSIVE_DARK_MODE, 0 if theme == "light" else 1)
    _set(hwnd, _DWMWA_CAPTION_COLOR, _colorref(c["caption"]))
    _set(hwnd, _DWMWA_BORDER_COLOR, _colorref(c["caption"]))
    _set(hwnd, _DWMWA_TEXT_COLOR, _colorref(c["text"]))
