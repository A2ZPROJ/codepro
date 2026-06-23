@echo off
REM ============================================================================
REM  Nexus-Reset.bat — Limpeza forcada do Nexus
REM
REM  Use este script quando o instalador do Nexus falha ou fica preso:
REM   - "comeca a instalar, da erro e fecha"
REM   - "da segunda vez nem comeca a instalar"
REM   - "processos abertos no gerenciador de tarefas"
REM
REM  O que este script faz:
REM   1. Mata qualquer processo do Nexus que esteja rodando
REM   2. Mata instaladores antigos presos
REM   3. Remove a pasta de instalacao
REM   4. Remove configuracoes corrompidas
REM
REM  NAO remove sua licenca (fica em %USERPROFILE%\.codepro)
REM ============================================================================

echo.
echo =============================================
echo   Nexus Reset — Limpeza de instalacao
echo =============================================
echo.

echo [1/5] Finalizando processos do Nexus...
taskkill /F /IM "Nexus.exe" /T >nul 2>&1
taskkill /F /IM "Nexus-Setup*.exe" /T >nul 2>&1
taskkill /F /IM "Nexus Setup*.exe" /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/5] Finalizando updater do electron (se rodando)...
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq electron.exe" /fo csv /nh 2^>nul ^| findstr /i "Nexus"') do taskkill /F /PID %%i >nul 2>&1
timeout /t 1 /nobreak >nul

echo [3/5] Removendo instalacao antiga...
if exist "%LOCALAPPDATA%\Programs\nexus" (
    rd /s /q "%LOCALAPPDATA%\Programs\nexus" >nul 2>&1
    echo     - pasta de instalacao removida
)
if exist "%LOCALAPPDATA%\Programs\Nexus" (
    rd /s /q "%LOCALAPPDATA%\Programs\Nexus" >nul 2>&1
    echo     - pasta de instalacao removida (maiusc)
)

echo [4/5] Removendo configuracoes corrompidas do cache...
if exist "%APPDATA%\Nexus" (
    rd /s /q "%APPDATA%\Nexus" >nul 2>&1
    echo     - cache Electron removido
)
if exist "%APPDATA%\codepro" (
    rd /s /q "%APPDATA%\codepro" >nul 2>&1
    echo     - cache codepro removido
)
if exist "%LOCALAPPDATA%\codepro-updater" (
    rd /s /q "%LOCALAPPDATA%\codepro-updater" >nul 2>&1
    echo     - cache auto-updater removido
)

echo [5/5] Removendo atalhos quebrados...
del /q "%PUBLIC%\Desktop\Nexus.lnk" >nul 2>&1
del /q "%USERPROFILE%\Desktop\Nexus.lnk" >nul 2>&1
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Nexus.lnk" >nul 2>&1

echo.
echo =============================================
echo   LIMPEZA CONCLUIDA
echo =============================================
echo.
echo  Sua licenca foi mantida em:
echo    %USERPROFILE%\.codepro\config.json
echo.
echo  Proximos passos:
echo   1. Baixe o Nexus-Setup mais recente em:
echo      https://github.com/A2ZPROJ/codepro/releases/latest
echo   2. Rode o instalador como administrador (clique direito)
echo   3. Se o Windows SmartScreen bloquear, clique em
echo      "Mais informacoes" e depois "Executar mesmo assim"
echo.
pause
