@echo off
title Motor de Encuestas - Digital Labs
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo No se encontro Node.js en esta computadora.
  echo Instalelo desde https://nodejs.org  ^(version LTS^) y vuelva a ejecutar este archivo.
  echo.
  pause
  exit /b
)

if not exist "node_modules" (
  echo.
  echo Instalando dependencias por primera vez. Esto tarda un par de minutos...
  echo.
  call npm install
)

echo.
echo Iniciando el servidor...
echo Sistema privado: http://localhost:3000/privado/
echo.
node server/server.js
pause
