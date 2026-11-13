@echo off
rem Staffroom on Windows: double-click, or run from a terminal in this folder.
cd /d "%~dp0"
if not exist .venv (
  echo Creating a Python environment...
  py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q -r requirements.txt
echo.
echo Staffroom is starting on http://localhost:8000  (press Ctrl+C to stop)
start "" http://localhost:8000
python -m uvicorn app.main:app --port 8000
