---
name: deploy-dll
description: Build DLL + embed + build Nexus completo (precompile+electron-builder) pra incluir DLL nova no instalador
user_invocable: true
---

# /deploy-dll — Build DLL + Build Nexus (sem publish)

Build completo: compila DLL, embarca no Nexus, gera instalador local. Nao publica no GitHub.

## Passos

1. **Build da DLL NETLOAD:**
   ```powershell
   cd "D:\PROGRAMAÇÃO\NETLOAD CIVIL 3D"
   dotnet build OSE_Reconectar.csproj -c Release
   ```
   Se falhar, parar e mostrar erro.

2. **Verificar DLL gerada:**
   ```powershell
   Get-Item "D:\PROGRAMAÇÃO\NETLOAD CIVIL 3D\bin\Release\net8.0-windows\GerarProjetoMND.dll" | Select-Object Name, Length, LastWriteTime
   ```

3. **Build do Nexus (inclui embed-civil3d.js via precompile):**
   ```powershell
   cd "D:\PROGRAMAÇÃO\NEXUS"
   npm run build
   ```
   Esse comando roda em sequencia:
   - `embed-civil3d.js` (encripta DLL nova → civil3d.bin)
   - `compile-obfuscate.js` + `obfuscate-html.js`
   - `electron-builder --win` (gera .exe em dist/)
   - `restore-source.js` (restaura fontes originais)

4. **Instalar DLL no bundle local pra teste:**
   ```powershell
   node scripts/c3d-install-dev.js
   ```

5. **Mostrar resultado:**
   - Caminho e tamanho do instalador gerado em `dist/`
   - Versao do package.json
   - "Instalador pronto em dist/. Use /publish pra subir pro GitHub."

## Timeout
O build do Nexus leva ~2-4 minutos. Usar timeout de 600000ms.
