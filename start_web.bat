@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m webapp --seed-demo %*
) else (
  python -m webapp --seed-demo %*
)
