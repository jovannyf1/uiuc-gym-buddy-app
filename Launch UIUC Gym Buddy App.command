#!/bin/zsh
set -e
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 24 or newer is needed to run UIUC Gym Buddy App."
  echo "Install it from https://nodejs.org and open this file again."
  read -r '?Press Return to close this window: '
  exit 1
fi

if [ ! -d node_modules ]; then npm install; fi
if [ ! -d client/node_modules ]; then npm --prefix client install; fi

echo "Starting UIUC Gym Buddy App at http://localhost:5173"
(sleep 3; open http://localhost:5173) &
npm run dev
