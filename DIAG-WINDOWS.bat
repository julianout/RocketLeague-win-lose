@echo off
setlocal
title Diagnostic Rocket League Stats API

echo.
echo === Diagnostic Rocket League Stats API ===
echo.
echo 1) Process Rocket League
tasklist | findstr /i "RocketLeague.exe RocketLeague"
if errorlevel 1 (
  echo Aucun process Rocket League trouve.
) else (
  echo Process Rocket League trouve.
)

echo.
echo 2) Port 49123 en ecoute
netstat -ano | findstr ":49123"
if errorlevel 1 (
  echo RIEN n'ecoute sur 49123.
  echo Si Rocket League est lance, le fichier ini n'est pas pris en compte ou le jeu n'a pas ete redemarre.
) else (
  echo Un process ecoute/utilise 49123. Regarde la colonne PID a droite.
)

echo.
echo 3) Test connexion TCP locale
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $iar = $c.BeginConnect('127.0.0.1',49123,$null,$null); if (-not $iar.AsyncWaitHandle.WaitOne(1500,$false)) { 'TIMEOUT 127.0.0.1:49123'; $c.Close(); exit 2 }; $c.EndConnect($iar); 'OK 127.0.0.1:49123 ouvert'; $c.Close(); exit 0 } catch { 'ECHEC 127.0.0.1:49123 - ' + $_.Exception.Message; exit 1 }"

echo.
echo 4) Emplacements probables du fichier a modifier
echo Epic:
echo   C:\Program Files\Epic Games\rocketleague\TAGame\Config\DefaultStatsAPI.ini
echo Steam:
echo   C:\Program Files (x86)\Steam\steamapps\common\rocketleague\TAGame\Config\DefaultStatsAPI.ini
echo.
echo Important: apres modification, ferme completement Rocket League puis relance-le.
echo.
pause
