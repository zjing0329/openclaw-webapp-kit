# OpenClaw Web App Kit

An OpenClaw 2026.6.6 starter kit for generating local React/Vite artifacts with generation-time web research.

Included:

- Yibu's Serper-compatible `web_search` provider.
- Yibu Jina Reader-backed `web_fetch` provider.
- A DeepDiver-derived React/Vite artifact skill.
- Local-only application guidance: static `dist`, `localStorage`, no Supabase, no API proxy, and no runtime cloud API calls.
- Sanitized configuration examples and installation scripts.

This repository does **not** contain OpenClaw itself, API keys, personal OpenClaw configuration, generated apps, trajectories, or the optional hard artifact gate.

## Requirements

- Node.js and npm
- OpenClaw `2026.6.6`

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

1. Research current facts with `web_search` and `web_fetch` when needed.
2. Build a component-based React/Vite project locally.
3. Store application data with `localStorage` instead of Supabase.
4. Avoid runtime API calls and remote assets.
5. run type checks, tests, lint, and a production build when available.
6. return a static `dist/index.html` artifact rather than a preview URL.

This is currently a soft workflow contract. It improves model behavior but does not technically prevent the model from finishing after a failed build.

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
