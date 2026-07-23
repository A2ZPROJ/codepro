@echo off
REM Duplo clique. Acha o Python 3 e aponta o Nexus pra ele (NEXUS_PYTHON).
REM Use quando o Nexus disser "Python nao encontrado. Instale o Python 3...".
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar-python.ps1"
if errorlevel 1 (
  echo.
  echo [falhou - codigo %errorlevel%]
  pause
)
