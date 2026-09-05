#!/usr/bin/env bash
set -euo pipefail

if ! command -v openclaw >/dev/null 2>&1; then
  echo "OpenClaw is not installed." >&2
  exit 1
fi

STATE_DIR="${OPENCLAW_STATE_DIR:-${OPENCLAW_HOME:-$HOME/.openclaw}}"
SECRET_DIR="$STATE_DIR/secrets"
SECRET_FILE="$SECRET_DIR/yibu-api-key"

printf "Yibu/Serper API key: "
IFS= read -r -s YIBU_KEY_INPUT
printf "\n"

if [[ -z "$YIBU_KEY_INPUT" ]]; then
  echo "The API key cannot be empty." >&2
  exit 1
fi

mkdir -p "$SECRET_DIR"
umask 077
printf "%s" "$YIBU_KEY_INPUT" > "$SECRET_FILE"
unset YIBU_KEY_INPUT
chmod 600 "$SECRET_FILE"

openclaw config set secrets.providers.yibu-local \
  --provider-source file \
  --provider-path "$SECRET_FILE" \
  --provider-mode singleValue
openclaw config set tools.web.search.yibu.apiKey \
  --ref-source file \
  --ref-provider yibu-local \
  --ref-id value
openclaw config set tools.web.search.provider yibu
openclaw config set tools.web.search.enabled true --strict-json
openclaw config set tools.web.fetch.provider yibu
openclaw config set tools.web.fetch.enabled true --strict-json
openclaw config set tools.web.fetch.readability false --strict-json
openclaw config set plugins.entries.yibu-websearch.enabled true --strict-json
openclaw config validate

echo "Yibu WebSearch is configured. Restart the Gateway with: openclaw gateway restart"
