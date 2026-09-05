import os from "node:os";
import path from "node:path";

import type { VerificationResult } from "./verifier.js";

export type RunGateState = {
  required: boolean;
  runId?: string;
  originalPrompt?: string;
  expectedProjectPath?: string;
  verification?: VerificationResult;
  webFetchCalls?: number;
};

export const RECOVERY_MARKER = "[LOCAL_ARTIFACT_GATE_RECOVERY]";

const BUILD_INTENT = /(?:创建|生成|编写|开发|实现|搭建|构建|制作|修改|修复|完善|迁移|写|做|create|build|implement|develop|fix|update|modify|make)/iu;
const REACT_ARTIFACT = /(?:\breact\b|\bvite\b|\bapp\b|web\s*app|miniapp|website|dashboard|planner|tracker|前端(?:项目|应用|页面)?|网页(?:应用|项目|页面)?|网站|页面|应用|小程序|路书|仪表盘|看板|规划器|追踪器)/iu;

export function isReactArtifactRequest(prompt: string): boolean {
  return !prompt.includes(RECOVERY_MARKER) && BUILD_INTENT.test(prompt) && REACT_ARTIFACT.test(prompt);
}

export function extractExpectedProjectPath(prompt: string): string | undefined {
  const candidates = prompt.match(/\/[\w.@~+\-\u4e00-\u9fff/]+/gu) ?? [];
  const workspace = candidates.find((candidate) => candidate.includes("/.openclaw/workspace/"));
  return workspace ? path.resolve(workspace.replace(/[.,;:]+$/u, "")) : undefined;
}

export function inferWorkspaceProjectPath(params: Record<string, unknown>): string | undefined {
  const marker = `${path.sep}.openclaw${path.sep}workspace${path.sep}`;
  const candidates: string[] = [];
  for (const key of ["projectPath", "path", "cwd"] as const) {
    const value = params[key];
    if (typeof value === "string") candidates.push(value);
  }
  if (typeof params.command === "string") {
    const matches = params.command.match(/(?:~|\/[\w.@+\-\u4e00-\u9fff]+(?:\/[\w.@+\-\u4e00-\u9fff]+)*)\/\.openclaw\/workspace\/[\w.@+\-\u4e00-\u9fff]+/gu);
    if (matches) candidates.push(...matches);
  }

  for (const candidate of candidates) {
    const expanded = candidate.startsWith("~/") ? path.join(os.homedir(), candidate.slice(2)) : candidate;
    if (!path.isAbsolute(expanded)) continue;
    const absolute = path.resolve(expanded);
    const markerIndex = absolute.indexOf(marker);
    if (markerIndex < 0) continue;
    const projectStart = markerIndex + marker.length;
    const projectName = absolute.slice(projectStart).split(path.sep)[0];
    if (projectName) return absolute.slice(0, projectStart) + projectName;
  }
  return undefined;
}

export const ARTIFACT_SYSTEM_GUIDANCE = `
## Local React artifact completion contract

This is an implementation request for a local web application. Use the local-react-artifact skill even if the user did not explicitly say React. Default to Vite + React + TypeScript, create the project under ~/.openclaw/workspace/<project-name>, and configure Vite with base './'.

Use web_search during generation when factual or current content would improve the app. Keep research bounded: use concise search results first, no more than three search calls, and make at most one web_fetch call when a source is essential. Save selected facts and URLs in local project data and SOURCES.md. Runtime code must stay local and offline. Do not use Supabase, API proxies, fetch, XMLHttpRequest, WebSocket, cloud SDKs, remote fonts, or remote runtime assets. Use localStorage for persistence unless the user requests another local mechanism.

Prioritize a complete, buildable MVP before exhaustive content. Keep initial seed data compact (roughly four to six useful entries per category), create every essential source file, install dependencies, and run the production build before adding optional breadth. Keep each file-write call focused and always provide both path and content.

A natural final answer is not completion. Before finishing, call local_artifact_verify with the absolute project path. Fix every reported error and call it again until it returns ok=true. The verifier runs the real production build and requires a fresh dist/index.html. Do not edit the project after successful verification; edits invalidate the proof. Report completion only after the verifier succeeds.
`.trim();

export function revisionInstruction(state: RunGateState): string {
  const expected = state.expectedProjectPath ? ` Expected project: ${state.expectedProjectPath}.` : "";
  const failure = state.verification && !state.verification.ok
    ? ` Last verification failed at ${state.verification.failedStage ?? "unknown"}: ${state.verification.error ?? "unknown error"}${state.verification.output ? `\n${state.verification.output}` : ""}`
    : " No successful local_artifact_verify call was recorded.";
  return `The local React artifact is not verified, so this run cannot finish.${expected}${failure}\nFix the project, then call local_artifact_verify again. Continue until it returns ok=true and do not merely describe the remaining work.`;
}
