@echo off
REM Roda o Nexus em MODO DEV (a partir do codigo-fonte, sem instalar). Fechar = fecha o app.
cd /d "%~dp0"
echo Iniciando Nexus em modo DEV...
call npm run dev
