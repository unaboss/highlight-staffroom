@echo off
rem Staffroom on Windows: double-click, or run from a terminal in this folder.
rem Serves the current code: Fast Track (React) at /fast-track, the Demo LMS at /lms.
rem   run.bat present   hides the Note button on every page (for presenting to the judges).
cd /d "%~dp0"
if not exist .venv (
  echo Creating a Python environment...
  py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q -r requirements.txt
if not exist web\dist\index.html (
  where npm >nul 2>nul && (
    echo Building the Fast Track app...
    pushd web
    call npm install --no-audit --no-fund
    call npm run build
    popd
  )
)
echo.
if /i "%~1"=="present" (set STAFFROOM_DEV_NOTES=0) else (set STAFFROOM_DEV_NOTES=1)
echo Staffroom is starting on http://localhost:8001  (press Ctrl+C to stop)
start "" http://localhost:8001/
python -m uvicorn app.main:app --port 8001
