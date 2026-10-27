@echo off
setlocal
cd /d "%~dp0"
set "PQE_PYTHON=.venv\Scripts\python.exe"
if exist "%PQE_PYTHON%" goto check_runtime
set "PQE_PYTHON=pq-escrow-clean\.venv\Scripts\python.exe"
if exist "%PQE_PYTHON%" goto check_runtime
echo Preparing PQ-Escrow for the first run...
python -m venv .venv
if errorlevel 1 goto setup_failed
set "PQE_PYTHON=.venv\Scripts\python.exe"

:check_runtime
"%PQE_PYTHON%" -c "from webapp.server import App, Server" >nul 2>&1
if not errorlevel 1 goto start_app
echo Installing the included offline dependencies...
"%PQE_PYTHON%" -m pip install --no-index --find-links wheelhouse -r requirements.txt
if errorlevel 1 goto setup_failed

:start_app
echo Keep this window open while using PQ-Escrow.
"%PQE_PYTHON%" -m webapp --seed-demo --port 8766 %*
if errorlevel 1 goto start_failed
exit /b 0

:setup_failed
echo.
echo Setup could not finish. Check that Python 3.13 is installed.
goto failed

:start_failed
echo.
echo PQ-Escrow could not start. Read the message above.

:failed
pause
exit /b 1
