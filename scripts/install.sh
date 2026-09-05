#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/plugins/yibu-websearch"
ARTIFACT_PLUGIN_DIR="$ROOT_DIR/plugins/local-artifact-gate"
SKILL_DIR="$ROOT_DIR/skills/local-react-artifact"
GUIDANCE_TEMPLATE="$ROOT_DIR/templates/AGENTS.react-artifact.md"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "OpenClaw is not installed. Run: npm install --global openclaw@2026.6.6" >&2
  exit 1
fi

OPENCLAW_VERSION="$(openclaw --version)"
if [[ "$OPENCLAW_VERSION" != "OpenClaw 2026.6.6"* ]]; then
  echo "This kit requires OpenClaw 2026.6.6; found: $OPENCLAW_VERSION" >&2
  echo "Install the pinned version with: npm install --global openclaw@2026.6.6" >&2
  exit 1
fi

echo "Building Yibu WebSearch plugin..."
npm ci --prefix "$PLUGIN_DIR"
npm run build --prefix "$PLUGIN_DIR"
npm test --prefix "$PLUGIN_DIR"

echo "Building Local Artifact Gate plugin..."
npm ci --prefix "$ARTIFACT_PLUGIN_DIR"
npm run build --prefix "$ARTIFACT_PLUGIN_DIR"
npm test --prefix "$ARTIFACT_PLUGIN_DIR"

echo "Installing plugins and skill..."
openclaw plugins install --force "$PLUGIN_DIR"
openclaw plugins install --force "$ARTIFACT_PLUGIN_DIR"
openclaw skills install --global --force "$SKILL_DIR" --as local-react-artifact

openclaw config set plugins.entries.local-artifact-gate.enabled true --strict-json
openclaw config set plugins.entries.local-artifact-gate.hooks.allowConversationAccess true --strict-json
openclaw config set plugins.entries.local-artifact-gate.hooks.allowPromptInjection true --strict-json
openclaw config set plugins.entries.local-artifact-gate.hooks.timeouts.before_agent_finalize 570000 --strict-json
openclaw config set plugins.entries.local-artifact-gate.config '{"buildTimeoutSeconds":60,"maxRevisionAttempts":12,"maxRecoveryAttempts":1,"recoveryTimeoutSeconds":420,"enforceNoRuntimeNetwork":true}' --strict-json

CURRENT_TOOL_ADDITIONS="$(openclaw config get tools.alsoAllow 2>/dev/null || printf '[]')"
MERGED_TOOL_ADDITIONS="$(node "$ROOT_DIR/scripts/merge-json-array.mjs" "$CURRENT_TOOL_ADDITIONS" local-artifact-gate)"
openclaw config set tools.alsoAllow "$MERGED_TOOL_ADDITIONS" --strict-json

CURRENT_PLUGIN_ALLOW="$(openclaw config get plugins.allow 2>/dev/null || printf '[]')"
MERGED_PLUGIN_ALLOW="$(node "$ROOT_DIR/scripts/merge-json-array.mjs" "$CURRENT_PLUGIN_ALLOW" yibu-websearch local-artifact-gate)"
openclaw config set plugins.allow "$MERGED_PLUGIN_ALLOW" --strict-json

WORKSPACE_PATH="${OPENCLAW_AGENT_WORKSPACE:-}"
if [[ -z "$WORKSPACE_PATH" ]]; then
  WORKSPACE_PATH="$(openclaw config get agents.defaults.workspace 2>/dev/null || true)"
  WORKSPACE_PATH="${WORKSPACE_PATH%\"}"
  WORKSPACE_PATH="${WORKSPACE_PATH#\"}"
fi
if [[ -z "$WORKSPACE_PATH" || "$WORKSPACE_PATH" == "null" ]]; then
  WORKSPACE_PATH="${OPENCLAW_STATE_DIR:-${OPENCLAW_HOME:-$HOME/.openclaw}}/workspace"
fi
node "$ROOT_DIR/scripts/install-workspace-guidance.mjs" "$WORKSPACE_PATH/AGENTS.md" "$GUIDANCE_TEMPLATE"

openclaw config validate
echo "Installation complete. Run ./scripts/configure-yibu.sh, then restart the OpenClaw Gateway."
