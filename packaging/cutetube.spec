# PyInstaller recipe for the installed app: one folder (fast start-up, fewer antivirus false alarms than one-file),
# windowed, with the downloaders' sources and metadata so they can run as helper processes and be updated.
# Build: .venv\Scripts\pyinstaller packaging\cutetube.spec  (or packaging\build.ps1 for the whole installer)
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules, copy_metadata

ROOT = Path(SPECPATH).parent

datas = [
    (str(ROOT / "frontend" / "dist"), "frontend/dist"),
    (str(ROOT / "app" / "browser" / "inject"), "app/browser/inject"),
    (str(ROOT / "app" / "assets"), "app/assets"),
    (str(ROOT / "legal"), "legal"),
    (str(ROOT / "LICENSE"), "."),
]
binaries = []
hiddenimports = collect_submodules("app") + collect_submodules("uvicorn") + collect_submodules("gallery_dl")
for pkg in ("yt-dlp", "gallery-dl", "yt-dlp-ejs"):
    datas += copy_metadata(pkg)
# GPL components ship with their source code (GPL-2.0 section 3).
for pkg in ("gallery_dl", "mutagen"):
    datas += collect_data_files(pkg, include_py_files=True)
for pkg in ("webview", "yt_dlp_ejs", "adblock"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    [str(ROOT / "run.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6", "gi", "cefpython3", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="CuteTube",
    icon=str(ROOT / "app" / "assets" / "cutetube.ico"),
    version=str(ROOT / "packaging" / "version_info.txt"),
    console=False,
    disable_windowed_traceback=True,  # errors go to the log / the parent process, not a "Failed to execute script" box
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="CuteTube", upx=False)
