#!/bin/zsh
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required."
  echo "Install it from https://nodejs.org, then run this launcher again."
  read -k 1 "?Press any key to close."
  exit 1
fi

echo "Starting Pinterest to Figma local proxy..."
echo "Proxy URL: http://127.0.0.1:8787"
echo
echo "Figma will open now. In Figma, run:"
echo "Plugins -> Development -> Pinterest to Figma"
echo
echo "Keep this window open while importing boards."

open -a "Figma" || true
npm start
