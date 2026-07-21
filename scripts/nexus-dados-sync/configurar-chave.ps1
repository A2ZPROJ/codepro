# Guarda a service_role key do Supabase pro agente de sync, SEM ela passar por
# linha de comando (nao vai pro historico do shell nem pro log da tarefa agendada).
#
# Uso: duplo clique no CONFIGURAR-CHAVE.bat
#
# ATENCAO: este arquivo roda no Windows PowerShell 5.1. Manter TUDO em ASCII puro
# (sem acento, sem tracos longos, sem box-drawing) - 5.1 le como ANSI e quebra o
# parser. Foi exatamente o que aconteceu em 21/07.

$ErrorActionPreference = 'Stop'
trap { Write-Host ''; Write-Host "ERRO: $_" -ForegroundColor Red; Write-Host ''; Read-Host 'Enter pra fechar' | Out-Null; exit 1 }

$dir = Join-Path $env:USERPROFILE '.nexus-sync'
$arq = Join-Path $dir 'service-key.txt'
$sync = Join-Path $PSScriptRoot 'sync.js'
$agendar = Join-Path $PSScriptRoot 'agendar.ps1'

if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

Write-Host ''
Write-Host 'Cole a SERVICE_ROLE key do projeto xszpzsmdpbgaiodeqcpi.'
Write-Host 'Supabase > Project Settings > API Keys > Secret / service_role'
Write-Host ''
Write-Host 'A DIGITACAO E INVISIVEL. Cola com Ctrl+V e da Enter mesmo sem ver nada.' -ForegroundColor Yellow
Write-Host ''

$sec = Read-Host -AsSecureString -Prompt 'service_role key'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if (-not $chave) {
  Write-Host 'Nada colado. Abortado.' -ForegroundColor Yellow
  Read-Host 'Enter pra fechar' | Out-Null
  exit 1
}

# confere o papel sem mostrar a chave
if ($chave.StartsWith('ey')) {
  try {
    $p = $chave.Split('.')[1].Replace('-', '+').Replace('_', '/')
    while ($p.Length % 4) { $p += '=' }
    $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
    if ($payload.role -and $payload.role -ne 'service_role') {
      Write-Host ''
      Write-Host "ERRO: essa chave e '$($payload.role)', nao service_role. A anon nao grava." -ForegroundColor Red
      Read-Host 'Enter pra fechar' | Out-Null
      exit 2
    }
    Write-Host "papel conferido: $($payload.role)" -ForegroundColor Green
  } catch {
    Write-Host '(nao consegui decodificar o papel; seguindo pro teste real)' -ForegroundColor DarkGray
  }
}

Set-Content -LiteralPath $arq -Value $chave -NoNewline -Encoding UTF8
icacls $arq /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

Write-Host ''
Write-Host "Chave gravada em: $arq" -ForegroundColor Green
Write-Host 'Permissao restrita ao seu usuario. Persiste em reboot.'

# testa a chave de verdade contra o banco (escrita)
Write-Host ''
Write-Host 'Testando a chave no Supabase...' -ForegroundColor Cyan

$url = 'https://xszpzsmdpbgaiodeqcpi.supabase.co/rest/v1/nexus_dados_sync'
$h = @{
  apikey        = $chave
  Authorization = "Bearer $chave"
  'Content-Type' = 'application/json'
  Prefer        = 'resolution=merge-duplicates,return=minimal'
}
$corpo = @{
  id       = 1
  rodou_em = (Get-Date).ToUniversalTime().ToString('o')
  origem   = "$env:COMPUTERNAME/$env:USERNAME (teste de chave)"
  arquivos = 0
} | ConvertTo-Json -Compress

$ok = $false
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-RestMethod -Uri $url -Method Post -Headers $h -Body "[$corpo]" -ErrorAction Stop | Out-Null
  Write-Host 'OK - a chave GRAVA no banco. Esta correta.' -ForegroundColor Green
  $ok = $true
} catch {
  $st = $null
  try { $st = $_.Exception.Response.StatusCode.value__ } catch {}
  if ($st -eq 401 -or $st -eq 403) {
    Write-Host "FALHOU (HTTP $st) - essa chave nao grava. Provavelmente e a anon/publishable." -ForegroundColor Red
    Write-Host 'Pegue a SECRET / service_role e rode de novo.' -ForegroundColor Red
  } else {
    Write-Host "FALHOU: $($_.Exception.Message)" -ForegroundColor Red
  }
}

if ($ok) {
  Write-Host ''
  Write-Host 'Rodando o sync agora...' -ForegroundColor Cyan
  & node $sync
  Write-Host ''
  Write-Host 'Pronto. Pra agendar 2x/dia, rode:' -ForegroundColor Green
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"$agendar`""
}

Write-Host ''
Read-Host 'Enter pra fechar' | Out-Null
