# Cria/atualiza a tarefa agendada do agente de sync NEXUS-DADOS -> Supabase.
# Roda 2x/dia (08:10 e 14:10) na sessao do usuario atual, sem janela.
#
# Uso:  powershell -ExecutionPolicy Bypass -File agendar.ps1
#       powershell -ExecutionPolicy Bypass -File agendar.ps1 -Remover

param([switch]$Remover)

$ErrorActionPreference = 'Stop'
$NOME = 'NEXUS-DadosSync'

if ($Remover) {
  if (Get-ScheduledTask -TaskName $NOME -EA SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $NOME -Confirm:$false
    Write-Host "tarefa '$NOME' removida." -ForegroundColor Yellow
  } else { Write-Host "tarefa '$NOME' nao existe." }
  exit 0
}

$sync = Join-Path $PSScriptRoot 'sync.js'
if (-not (Test-Path -LiteralPath $sync)) { throw "nao achei o sync.js em $PSScriptRoot" }

$node = (Get-Command node -EA SilentlyContinue).Source
if (-not $node) { throw 'node nao esta no PATH.' }

$logDir = Join-Path $env:USERPROFILE '.claude\logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir 'nexus-dados-sync.log'

# cmd /c pra conseguir redirecionar a saida pro log (append)
$args = "/c `"`"$node`" `"$sync`" >> `"$log`" 2>&1`""
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $args -WorkingDirectory $PSScriptRoot

$gatilhos = @(
  (New-ScheduledTaskTrigger -Daily -At 08:10),
  (New-ScheduledTaskTrigger -Daily -At 14:10)
)

# roda so quando o usuario esta logado (precisa do OneDrive montado)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

$cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $NOME -EA SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $NOME -Confirm:$false
}
Register-ScheduledTask -TaskName $NOME -Action $acao -Trigger $gatilhos `
  -Principal $principal -Settings $cfg `
  -Description 'Sobe os JSONs de _APOIO\NEXUS-DADOS pro Supabase (tabela nexus_dados).' | Out-Null

Write-Host "tarefa '$NOME' criada: 08:10 e 14:10, log em $log" -ForegroundColor Green
Write-Host 'rodar agora:  Start-ScheduledTask -TaskName ' -NoNewline; Write-Host $NOME
