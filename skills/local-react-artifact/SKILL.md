---
name: local-react-artifact
description: Create or modify a local React/Vite app and deliver a verified static dist. Use for implementation requests involving apps, websites, pages, miniapps, dashboards, planners, trackers, travel guides, and similar interactive web artifacts, even when the user does not explicitly name React.
user-invocable: false
---

# Local React Artifact

Build a real component-based React application for local, static execution. This skill adapts the React/Vite and web-app delivery workflow from DeepDiver without Daytona, Supabase, API proxies, deployment services, or runtime cloud dependencies.

## Architecture

- Put generated applications under `~/.openclaw/workspace/<project-name>` unless the user supplies another local path.
- Use Vite + React + TypeScript by default. A user-named stack wins.
- Configure Vite with `base: './'` so the built assets use portable relative paths.
- Keep application code in `src/` and split meaningful interface areas into components.
- Use versioned `localStorage` for persistence unless the user asks for another local mechanism.
- Do not add Supabase, API proxies, deployment-only routes, or runtime cloud calls.
- Generation-time `web_search` is encouraged when the requested app needs current or factual content. Use concise search results first, make no more than three targeted search calls, and make at most one `web_fetch` call when a source is essential.
- Record selected facts and their URLs in `SOURCES.md`.
- Runtime code and assets must be local. Do not use `fetch`, `XMLHttpRequest`, `WebSocket`, remote API clients, or remote image/font/script URLs.

## Dependency Discipline

- Check `package.json` before importing a package.
- Install every imported package and keep the lockfile.
- Prefer the project's existing package manager. Do not mix npm, pnpm, yarn, or bun lockfiles.
- Keep one state-management implementation and one public module contract.
- When changing exports, search all imports before building again.

## Implementation Workflow

1. Choose a short project slug and state the absolute project path before writing files.
2. Inspect an existing destination or create a new project under the artifact workspace. Never overwrite an unrelated non-empty directory.
3. Establish the required user flows and data model before coding.
4. Research factual content with web tools when needed; keep the results concise and do not make runtime network access part of the generated app.
5. Implement a complete MVP before adding breadth. Keep initial seed data to roughly four to six useful entries per category.
6. Create every essential source file, install dependencies, and run the first production build early.
7. Validate incrementally after each substantial group of edits and fix errors before adding more features.

Every `write` call must include both `path` and `content`. Prefer focused files and avoid spending the context window on exhaustive static datasets before the app builds.

## Verification

Before reporting completion:

1. Run the project's type-check script, or `npx tsc --noEmit` for TypeScript projects.
2. Run tests and lint when the project defines them.
3. Run the package's production build.
4. Fix every error and repeat the checks. A failed command is not completion.
5. Call `local_artifact_verify` with the absolute project path.
6. Treat that tool as the final authority: continue fixing and calling it until it returns `ok: true`.
7. Do not edit project files after successful verification; any edit invalidates the proof and requires another call.

The final answer must report the project path, the commands run, the verification result, and the static entry path. Do not start a persistent development server and do not return a preview URL unless the user explicitly asks for one.
