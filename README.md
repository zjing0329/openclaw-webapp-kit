# OpenClaw Web App Kit

An OpenClaw 2026.6.6 starter kit for generating local React/Vite artifacts with generation-time web research.

Included:

- Yibu's Serper-compatible `web_search` provider.
- Yibu Jina Reader-backed `web_fetch` provider.
- A DeepDiver-derived React/Vite artifact skill.
- A `local_artifact_verify` tool that performs the real production build and validates the static output.
- Prompt, Tool Call, and finalization hooks that keep app-building turns running until verification succeeds.
- A managed `AGENTS.md` policy that routes natural-language app requests into the React workflow.
- Local-only application guidance: static `dist`, `localStorage`, no Supabase, no API proxy, and no runtime cloud API calls.
- Sanitized configuration examples and installation scripts.

This repository does **not** contain OpenClaw itself, API keys, personal OpenClaw configuration, generated apps, or trajectories.

## Requirements

- Node.js and npm
- OpenClaw `2026.6.6`

## Version Compatibility

This kit intentionally targets the exact stable release `2026.6.6`, Git tag `v2026.6.6`, release commit `8c802aa`. The installer stops when another OpenClaw version is active.

OpenClaw uses `YYYY.M.PATCH` version names. Starting with the June 2026 release process, the third component is a sequential monthly release-train number, not a calendar day. Therefore `2026.6.6` means the sixth June 2026 release train, not June 6, 2026.

- [Official OpenClaw 2026.6.6 release](https://github.com/openclaw/openclaw/releases/tag/v2026.6.6)
- [Official npm package](https://www.npmjs.com/package/openclaw/v/2026.6.6)

Install OpenClaw if necessary:

```bash
npm install --global openclaw@2026.6.6
```

## Install

```bash
git clone https://github.com/zjing0329/openclaw-webapp-kit.git
cd openclaw-webapp-kit
./scripts/install.sh
./scripts/configure-yibu.sh
openclaw gateway restart
```

`configure-yibu.sh` asks for the key without echoing it and writes it to `~/.openclaw/secrets/yibu-api-key` with owner-only permissions. The key is never written into this repository.

The installer also adds a marker-delimited React artifact section to the active agent workspace's `AGENTS.md`. Re-running the installer replaces that managed section instead of duplicating it; unrelated workspace instructions are preserved.

Because the default `coding` tool profile does not include third-party plugin tools, the installer adds only the `local-artifact-gate` plugin id through `tools.alsoAllow`. This preserves the profile's file, runtime, web, session, and memory tools without replacing its defaults. It adds `yibu-websearch` and `local-artifact-gate` to `plugins.allow` without removing existing entries.

## Configure Yibu/Serper Search

The plugin calls Yibu's Serper-compatible endpoint. Obtain an API key from your Yibu account, then run:

```bash
./scripts/configure-yibu.sh
```

The resulting local configuration is:

- Secret value: `~/.openclaw/secrets/yibu-api-key`
- Secret reference and provider selection: `~/.openclaw/openclaw.json`

Do not send either file with real credentials. To configure another machine, run the script there with that machine owner's key.

As an alternative, set `YIBU_KEY` in `~/.openclaw/.env` and configure `yibu` as the web search/fetch provider. Do not commit that `.env` file.

## Configure Pangu

Pangu is optional and specific to the deployment account. It is not required by the WebSearch plugin or artifact skill.

1. Copy the variable names from `.env.example` into `~/.openclaw/.env`.
2. Replace every placeholder with credentials issued to that user.
3. Protect the file with `chmod 600 ~/.openclaw/.env`.
4. Apply the provider template:

```bash
openclaw config patch --file ./config/pangu-provider.example.json5 --dry-run
openclaw config patch --file ./config/pangu-provider.example.json5
openclaw gateway restart
```

The local Pangu values that must be supplied separately are:

- `PANGU_API_KEY`: Bearer/API key
- `PANGU_HW_ID`: Huawei account or tenant identifier
- `PANGU_HW_APP_KEY`: Huawei application key

Do not share your own values. Each user or deployment should use independently issued credentials.

## Artifact Workflow

For React/Vite artifact requests, the installed skill instructs OpenClaw to:

1. Research current facts with bounded `web_search` and selective `web_fetch` calls when needed.
2. Build a component-based React/Vite project locally.
3. Store application data with `localStorage` instead of Supabase.
4. Avoid runtime API calls and remote assets.
5. Run type checks, tests, lint, and a production build when available.
6. Call `local_artifact_verify`, fix its reported errors, and retry until it returns `ok: true`.
7. Return a static `dist/index.html` artifact rather than a preview URL.

The workflow is implemented in four extension layers without patching OpenClaw core:

1. The active workspace's `AGENTS.md` routes app implementation requests to this workflow.
2. `skills/local-react-artifact/SKILL.md` defines the generation and offline-runtime contract.
3. `plugins/local-artifact-gate` registers `local_artifact_verify` and injects turn-specific system guidance.
4. Its Tool Call and `before_agent_finalize` hooks discover the project path, run verification, and use bounded light-context recovery turns when a provider stops after writing partial files.

Revision and recovery counts are bounded and configurable. The default is one seven-minute light-context recovery plus local verification, kept within OpenClaw 2026.6.6's ten-minute hook limit. Recovery continues from the generated files in an isolated session, so OpenClaw's protection against replaying a side-effecting turn remains intact.

## Files That Stay Local

Never upload or send these files as-is:

- `~/.openclaw/openclaw.json`
- `~/.openclaw/.env`
- `~/.openclaw/secrets/**`
- `~/.openclaw/agents/**/agent/models.json`
- `~/.openclaw/workspace/**`
- OpenClaw sessions, logs, trajectories, backups, and auth profiles

Share the templates in this repository instead. Before publishing changes, run:

```bash
./scripts/check-secrets.sh
```
