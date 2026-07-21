@echo off
REM Duplo clique aqui. Cola a service_role key quando pedir (digitacao INVISIVEL).
REM Grava em %USERPROFILE%\.nexus-sync\service-key.txt, testa no banco e ja roda o sync.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar-chave.ps1"
if errorlevel 1 (
  echo.
  echo [falhou - codigo %errorlevel%]
  pause
)
