@echo off
:: Inicia el servidor protegido y abre la aplicacion en el navegador predeterminado.
title DentalRos - Inicio
where node >nul 2>&1
if errorlevel 1 (
  echo No se encontro Node.js 24 o superior.
  echo Instala Node.js desde https://nodejs.org y vuelve a intentarlo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 24 (
  echo Se requiere Node.js 24 o superior. Version detectada: %NODE_MAJOR%.
  pause
  exit /b 1
)

echo Iniciando DentalRos de forma segura...
start "Servidor DentalRos" /min node "%~dp0server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3000"
exit
