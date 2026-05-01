#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installe. Installe Node.js LTS puis relance ce fichier."
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5177/control.html" >/dev/null 2>&1 || true
fi

echo "Panneau: http://localhost:5177/control.html"
echo "OBS:     http://localhost:5177/overlay.html"
echo "Laisse ce terminal ouvert pendant que tu joues."
npm start
