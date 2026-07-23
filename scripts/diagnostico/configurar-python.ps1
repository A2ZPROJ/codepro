# Acha o Python 3 na maquina e aponta o Nexus pra ele (env NEXUS_PYTHON).
# Resolve o erro "Python nao encontrado. Instale o Python 3 ou defina NEXUS_PYTHON."
#
# Uso: duplo clique no CONFIGURAR-PYTHON.bat
#
# ATENCAO: roda no Windows PowerShell 5.1 -> manter TUDO em ASCII puro.

$ErrorActionPreference = 'Stop'
trap { Write-Host ''; Write-Host "ERRO: $_" -ForegroundColor Red; Read-Host 'Enter pra fechar' | Out-Null; exit 1 }

function Testa($exe, $args) {
  try {
    $v = & $exe @args --version 2>&1
    if ($LASTEXITCODE -eq 0) { return ($v | Out-String).Trim() }
  } catch {}
  return $null
}

Write-Host ''
Write-Host '=== Procurando Python 3 nesta maquina ===' -ForegroundColor Cyan
Write-Host ("usuario: {0}" -f $env:USERNAME)
Write-Host ''

$cands = New-Object System.Collections.Generic.List[string]
$add = { param($p) if ($p -and -not $cands.Contains($p)) { [void]$cands.Add($p) } }

if ($env:NEXUS_PYTHON) { & $add $env:NEXUS_PYTHON }

$raizes = @(
  (Join-Path $env:USERPROFILE 'AppData\Local\Programs\Python'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Python'),
  $env:ProgramFiles,
  ${env:ProgramFiles(x86)},
  'C:\'
) | Where-Object { $_ }

foreach ($r in $raizes) {
  if (-not (Test-Path -LiteralPath $r)) { continue }
  $dirs = Get-ChildItem -LiteralPath $r -Directory -EA SilentlyContinue |
          Where-Object { $_.Name -match '^Python ?3[\d.]*$' } |
          Sort-Object Name -Descending
  foreach ($d in $dirs) { & $add (Join-Path $d.FullName 'python.exe') }
}

# registro
foreach ($hive in 'HKCU:','HKLM:') {
  $base = "$hive\Software\Python\PythonCore"
  if (-not (Test-Path $base)) { continue }
  Get-ChildItem $base -EA SilentlyContinue | ForEach-Object {
    $ip = Join-Path $_.PSPath 'InstallPath'
    if (Test-Path $ip) {
      $v = (Get-ItemProperty -Path $ip -EA SilentlyContinue).ExecutablePath
      if ($v) { & $add $v }
    }
  }
}

$escolhido = $null
foreach ($c in $cands) {
  $ok = $false
  if (Test-Path -LiteralPath $c) {
    if ($c -notmatch '\\WindowsApps\\') {
      $fi = Get-Item -LiteralPath $c
      if ($fi.Length -gt 0) { $ok = $true }
    }
  }
  if ($ok) {
    $ver = Testa $c @()
    if ($ver) {
      Write-Host ("  ACHOU  {0}  -> {1}" -f $c, $ver) -ForegroundColor Green
      if (-not $escolhido) { $escolhido = $c }
      continue
    }
  }
  Write-Host ("  nao    {0}" -f $c) -ForegroundColor DarkGray
}

# launcher py
$verPy = Testa 'py' @('-3')
if ($verPy) { Write-Host ("  ACHOU  launcher 'py -3'  -> {0}" -f $verPy) -ForegroundColor Green }

Write-Host ''
if ($escolhido) {
  [Environment]::SetEnvironmentVariable('NEXUS_PYTHON', $escolhido, 'User')
  Write-Host 'PRONTO.' -ForegroundColor Green
  Write-Host ("NEXUS_PYTHON = {0}" -f $escolhido)
  Write-Host ''
  Write-Host 'FECHE E ABRA O NEXUS pra ele pegar a variavel.' -ForegroundColor Yellow
} elseif ($verPy) {
  # sem exe absoluto, mas o launcher funciona: descobre o caminho real por ele
  $real = (& py -3 -c "import sys; print(sys.executable)" 2>$null | Out-String).Trim()
  if ($real -and (Test-Path -LiteralPath $real)) {
    [Environment]::SetEnvironmentVariable('NEXUS_PYTHON', $real, 'User')
    Write-Host 'PRONTO (via launcher py).' -ForegroundColor Green
    Write-Host ("NEXUS_PYTHON = {0}" -f $real)
    Write-Host ''
    Write-Host 'FECHE E ABRA O NEXUS pra ele pegar a variavel.' -ForegroundColor Yellow
  } else {
    Write-Host 'O launcher py responde mas nao consegui o caminho do executavel.' -ForegroundColor Yellow
  }
} else {
  Write-Host 'NAO HA PYTHON 3 INSTALADO NESTA MAQUINA.' -ForegroundColor Red
  Write-Host ''
  Write-Host 'Instale por aqui:  https://www.python.org/downloads/'
  Write-Host 'Na 1a tela do instalador, MARQUE "Add python.exe to PATH".' -ForegroundColor Yellow
  Write-Host 'Depois rode este mesmo arquivo de novo.'
}

Write-Host ''
Read-Host 'Enter pra fechar' | Out-Null
