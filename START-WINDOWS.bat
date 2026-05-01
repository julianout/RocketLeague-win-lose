@echo off
setlocal
title Rocket League Win/Lose Overlay
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js n'est pas installe.
  echo Installe la version LTS ici : https://nodejs.org/
  echo Puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

echo.
echo Rocket League Win/Lose Overlay
echo.
if not exist node_modules (
  echo Installation des dependances...
  call npm install
  if errorlevel 1 (
    echo.
    echo Echec npm install.
    pause
    exit /b 1
  )
)
start "" "http://localhost:5177/control.html"
echo.
echo Overlay OBS lance.
echo Panneau: http://localhost:5177/control.html
echo OBS:     http://localhost:5177/overlay.html
echo.
npm start
pause
