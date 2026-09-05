#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if rg -n --hidden \
  --glob '!.git/**' \
  --glob '!package-lock.json' \
  --glob '!.env.example' \
  '(sk-[A-Za-z0-9_-]{20,}|Bearer[[:space:]]+[A-Za-z0-9._-]{20,}|AIza[0-9A-Za-z_-]{20,})' \
  "$ROOT_DIR"; then
  echo "Potential secret detected. Review the matches before committing." >&2
  exit 1
fi

echo "No common plaintext API-key patterns detected."
