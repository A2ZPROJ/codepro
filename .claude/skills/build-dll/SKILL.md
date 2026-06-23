---
name: build-dll
description: Compila a DLL do NETLOAD Civil 3D e instala no bundle do Nexus pra teste local
user_invocable: true
---

# /build-dll — Build + deploy local da DLL Civil 3D

Compila o projeto NETLOAD e instala no bundle do Nexus pra teste no Civil 3D.

## Passos

1. **Build da DLL:**
   ```powershell
   cd "D:\PROGRAMAÇÃO\NETLOAD CIVIL 3D"
   dotnet build OSE_Reconectar.csproj -c Release
   ```
   - NAO usar flag `-o` (output vai pra `bin\Release\net8.0-windows\` por padrao)
   - Se falhar, mostrar o erro e parar

2. **Embed no Nexus (encriptar DLL → civil3d.bin):**
   ```powershell
   cd "D:\PROGRAMAÇÃO\NEXUS"
   node scripts/embed-civil3d.js
   ```

3. **Instalar no bundle local (descriptografar → ApplicationPlugins):**
   ```powershell
   node scripts/c3d-install-dev.js
   ```
   - Se der EBUSY, avisar: "Feche o Civil 3D antes de rodar /build-dll"

4. **Confirmar sucesso:**
   - Mostrar tamanho da DLL gerada
   - Mostrar Version.txt do bundle
   - Lembrar: "Reabra o Civil 3D pra carregar a nova versao"

## NUNCA fazer
- Copiar DLL manualmente pro bundle (Nexus sobrescreve com civil3d.bin)
- Usar `dotnet build -o <path>`
- Pular o embed-civil3d.js (o bundle fica desatualizado)
