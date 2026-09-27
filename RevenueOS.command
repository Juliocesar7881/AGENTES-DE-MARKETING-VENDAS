#!/bin/bash
# RevenueOS for macOS/Linux — double-click (macOS) or run ./RevenueOS.command
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required: https://nodejs.org/en/download"
  open "https://nodejs.org/en/download" 2>/dev/null || true
  read -r -p "Press Enter to close…"
  exit 1
fi
command -v pnpm >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || npm install -g pnpm@10
if [ ! -d node_modules/.pnpm ]; then
  echo "Installing RevenueOS — first run only, this takes a few minutes…"
  pnpm install || { read -r -p "Installation failed. Press Enter to close…"; exit 1; }
fi
exec node --import tsx scripts/launcher.ts "$@"
