# OpenClaw Local Artifact Gate

Local-only React/Vite completion controls adapted from DeepDiver's `react_vite`, `web_app`, artifact manifest, and publish-build gates. This plugin is distributed as part of OpenClaw Web App Kit.

The plugin exposes `local_artifact_verify`, injects the completion contract for app-building requests, and tracks the project directory from local Tool Calls. At finalization it verifies the project directly; if the provider stopped early after file side effects, it can run bounded, light-context recovery turns against the existing project and verify again. The companion `local-react-artifact` skill is installed by the kit's installer.

It does not include Daytona, Supabase, API proxy, deployment, storage, or cloud runtime integrations. By default it verifies only projects under `~/.openclaw/workspace` and rejects runtime networking in generated source.
