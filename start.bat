@echo off
rem Launch CuteTube (run setup steps in README.md once first)
cd /d "%~dp0"
if not exist frontend\dist\index.html (
  echo Building the interface...
  pushd frontend && call npm install && call npm run build && popd
)
start "" .venv\Scripts\pythonw.exe run.py
