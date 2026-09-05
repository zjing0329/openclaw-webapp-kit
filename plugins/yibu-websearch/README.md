# Yibu Web Search for OpenClaw

This OpenClaw plugin provides only web capabilities:

- `web_search` through Yibu's Serper-compatible endpoint.
- `web_fetch` through Yibu's Jina Reader endpoint.

It does not register skills, custom tools, hooks, trajectories, artifact builders, API proxies, or runtime services.

The API key is read from `tools.web.search.yibu.apiKey` or `YIBU_KEY`. Use the repository's `scripts/configure-yibu.sh` helper to store it as a file-backed OpenClaw SecretRef. Never commit the real key.
