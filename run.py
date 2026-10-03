import sys

from app import overlay


def _run_module() -> None:
    """`CuteTube.exe -m gallery_dl …`: the packaged app has no python.exe, so it stands in for one when the app
    runs a downloader as its own process."""
    import runpy

    module = sys.argv[2]
    if module != "gallery_dl":
        sys.stderr.write(f"unknown module {module}\n")
        raise SystemExit(2)
    sys.argv = [module] + sys.argv[3:]
    try:
        runpy.run_module(module, run_name="__main__", alter_sys=True)
    except SystemExit:
        raise
    except BaseException:  # a helper reports to its parent through stderr, never with a dialog
        import traceback

        traceback.print_exc()
        raise SystemExit(1)


def _crashed() -> None:
    """The installed app has no console: keep the error in a log and say so in plain words."""
    import ctypes
    import traceback

    from app.config import DATA_DIR

    log = DATA_DIR / "error.log"
    try:
        log.write_text(traceback.format_exc(), "utf-8")
    except OSError:
        pass
    ctypes.windll.user32.MessageBoxW(
        None, f"CuteTube couldn't start and had to close.\n\nDetails were saved to:\n{log}", "CuteTube", 0x10)


if __name__ == "__main__":
    helper = len(sys.argv) > 2 and sys.argv[1] == "-m"
    overlay.activate(clean=not helper)
    if helper:
        _run_module()
    else:
        try:
            from app.main import main

            main()
        except Exception:
            if not overlay.FROZEN:
                raise
            _crashed()
            raise SystemExit(1)
