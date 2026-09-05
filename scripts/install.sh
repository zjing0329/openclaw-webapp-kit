#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/plugins/yibu-websearch"
SKILL_DIR="$ROOT_DIR/skills/local-react-artifact"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "OpenClaw is not installed. Run: npm install --global openclaw@2026.6.6" >&2
  exit 1
fi

echo "Building Yibu WebSearch plugin..."
npm ci --prefix "$PLUGIN_DIR"
npm run build --prefix "$PLUGIN_DIR"
npm test --prefix "$PLUGIN_DIR"

echo "Installing plugin and skill..."
openclaw plugins install --force "$PLUGIN_DIR"
openclaw skills install --global --force "$SKILL_DIR" --as local-react-artifact

echo "Installation complete. Run ./scripts/configure-yibu.sh, then restart the OpenClaw Gateway."
