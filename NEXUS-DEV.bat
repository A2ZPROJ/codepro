@echo off
title Nexus (DEV - contorno tela branca)
cd /d "D:\PROGRAMACAO\NEXUS"
if not exist "src\main.js" cd /d "D:\PROGRAMAÇÃO\NEXUS"
echo Abrindo o Nexus em modo DEV (contorno enquanto o build publicado esta com tela branca)...
echo NAO feche esta janela enquanto usar o Nexus.
call npx electron .
