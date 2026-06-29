@echo off
REM Atualiza a instalacao LOCAL do Nexus pra ultima versao PUBLICADA e abre sozinho.
cd /d "%~dp0"
call npm run atualizar
echo.
echo Esta janela pode ser fechada. O Nexus novo abre sozinho em alguns segundos.
timeout /t 6 >nul
