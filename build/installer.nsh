; ============================================================================
;  installer.nsh — Hooks customizados do instalador NSIS do Nexus
;  electron-builder chama estas macros automaticamente.
; ============================================================================

; customInit roda ANTES de copiar arquivos.
; Missão: matar instâncias do Nexus que estejam rodando (se user clicou
; pra atualizar com o app aberto), e stubs de instaladores anteriores
; que tenham travado em %TEMP%. Isso resolve o cenário "começa a instalar,
; dá erro, fecha, e da segunda vez nem começa".
!macro customInit
  DetailPrint "Nexus: finalizando instâncias em execução..."

  ; Mata o app principal. /F força, /T leva os filhos (electron.exe do Nexus).
  ; Usa 2>nul pra não mostrar erro se não estiver rodando.
  nsExec::Exec `cmd /c taskkill /F /IM "Nexus.exe" /T 2>nul`
  Pop $0
  Sleep 800

  ; Mata stubs de instaladores anteriores que tenham ficado presos.
  nsExec::Exec `cmd /c taskkill /F /IM "Nexus-Setup*.exe" /T 2>nul`
  Pop $0
  Sleep 400

  ; Mata updater do electron que pode estar segurando o diretório de install.
  nsExec::Exec `cmd /c taskkill /F /IM "Nexus Setup*.exe" /T 2>nul`
  Pop $0
  Sleep 400

  DetailPrint "Nexus: processos finalizados, prosseguindo com instalação..."
!macroend

; customUnInstall roda no desinstalador.
; Mesma lógica: garante que nada do Nexus está vivo antes de apagar os .exe.
!macro customUnInstall
  DetailPrint "Nexus: finalizando instância antes de desinstalar..."
  nsExec::Exec `cmd /c taskkill /F /IM "Nexus.exe" /T 2>nul`
  Pop $0
  Sleep 800
!macroend

; customInstall roda DEPOIS de copiar os arquivos.
; Útil pra logging e para exibir mensagem amigável se algo tiver falhado.
!macro customInstall
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "Falha durante a instalação do Nexus.$\r$\n$\r$\nPossíveis causas:$\r$\n  - Antivírus bloqueando o instalador$\r$\n  - Nexus aberto em outra janela$\r$\n  - Espaço insuficiente em disco$\r$\n$\r$\nTente rodar 'Nexus-Reset.bat' e reinstalar."
  ${EndIf}
!macroend
