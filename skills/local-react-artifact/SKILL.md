---
name: local-react-artifact
description: Build or modify a local React/Vite app as a verified static artifact. Use for React apps, Vite apps, frontend apps, miniapps, dashboards, planners, trackers, travel guides, and similar interactive web artifacts.
user-invocable: false
---

# Local React Artifact

Build a real component-based React application for local, static execution. This skill adapts the React/Vite and web-app delivery workflow from DeepDiver without Daytona, Supabase, API proxies, deployment services, or a hard completion gate.

## Architecture

- Put generated applications under `~/.openclaw/workspace/<project-name>` unless the user supplies another local path.
- Use Vite + React + TypeScript by default. A user-named stack wins.
- Keep application code in `src/` and split meaningful interface areas into components.
- Use versioned `localStorage` for persistence unless the user asks for another local mechanism.
- Do not add Supabase, API proxies, deployment-only routes, or runtime cloud calls.
- Generation-time `web_search` and `web_fetch` are allowed and encouraged when the requested app needs current or factual content.
- Record selected facts and their URLs in `SOURCES.md`.
- Runtime code and assets must be local. Do not use `fetch`, `XMLHttpRequest`, `WebSocket`, remote API clients, or remote image/font/script URLs.

## Dependency Discipline

- Check `package.json` before importing a package.
- Install every imported package and keep the lockfile.
- Prefer the project's existing package manager. Do not mix npm, pnpm, yarn, or bun lockfiles.
- Keep one state-management implementation and one public module contract.
- When changing exports, search all imports before building again.

## Implementation Workflow

1. Inspect the project and establish the required user flows before coding.
2. Research factual content with web tools when needed; do not make runtime network access part of the generated app.
3. Implement the application in coherent component and data modules.
4. Validate incrementally after each substantial group of edits.
5. Fix errors before adding more features.

## Verification

Before reporting completion:

1. Run the project's type-check script, or `npx tsc --noEmit` for TypeScript projects.
2. Run tests and lint when the project defines them.
3. Run the package's production build.
4. Fix every error and repeat the checks. A failed command is not completion.
5. Confirm that `dist/index.html` exists and that its referenced entry assets are local.
6. Do not edit project files after the final successful build without rebuilding.

The final answer must report the project path, the commands run, the build result, and the static entry path. Do not start a persistent development server and do not return a preview URL unless the user explicitly asks for one.
