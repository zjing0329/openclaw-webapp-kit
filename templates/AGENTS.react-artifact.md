<!-- openclaw-webapp-kit:react-artifact:start -->
## Local React Application Delivery

Treat requests to create or substantially modify an app, website, page, dashboard, planner, tracker, miniapp, or other interactive web experience as local React artifact implementation tasks, even when the user does not explicitly name React.

- Use the `local-react-artifact` skill and default to Vite + React + TypeScript.
- Put new projects under `~/.openclaw/workspace/<project-name>` unless the user supplies another local path.
- Use concise `web_search` results during generation when factual content is needed. Keep research bounded and make at most one `web_fetch` call for an essential source, then store selected content and source URLs in the project.
- Keep the generated app offline at runtime: use local data/assets and `localStorage`; do not add Supabase, API proxies, runtime cloud calls, or remote assets.
- Deliver a complete, buildable MVP before expanding content. Keep initial seed data compact, create every essential source file, install dependencies, and build early.
- Do not finish after merely writing code. Call `local_artifact_verify`, fix every reported problem, and repeat until it returns `ok: true` with a fresh `dist/index.html`.
<!-- openclaw-webapp-kit:react-artifact:end -->
