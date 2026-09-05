import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  extractExpectedProjectPath,
  inferWorkspaceProjectPath,
  isReactArtifactRequest,
  RECOVERY_MARKER,
} from "./gate.js";
import { verificationStillCurrent, verifyLocalArtifact } from "./verifier.js";

const tempDirs: string[] = [];

async function fixture(buildScript: string, source = "export const value = 1;\n"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-artifact-gate-"));
  tempDirs.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "main.js"), source);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "fixture",
    private: true,
    scripts: { build: "node build.mjs" },
  }));
  await fs.writeFile(path.join(root, "build.mjs"), buildScript);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("request detection", () => {
  it("detects React generation tasks and their OpenClaw project path", () => {
    const prompt = "请创建 React 项目，目录为 /Users/test/.openclaw/workspace/hk-roadbook。";
    expect(isReactArtifactRequest(prompt)).toBe(true);
    expect(extractExpectedProjectPath(prompt)).toBe("/Users/test/.openclaw/workspace/hk-roadbook");
  });

  it("detects a natural-language app request without an explicit React keyword", () => {
    expect(isReactArtifactRequest("写一个香港路书app，包含美食、景点、交通和住宿")).toBe(true);
    expect(isReactArtifactRequest("做一个本地旅行规划器")).toBe(true);
  });

  it("does not gate an explanatory React question", () => {
    expect(isReactArtifactRequest("解释一下 React hooks")).toBe(false);
  });

  it("infers a project root from file and command tool parameters", () => {
    expect(inferWorkspaceProjectPath({ path: "/Users/test/.openclaw/workspace/hk-roadbook/src/App.tsx" }))
      .toBe("/Users/test/.openclaw/workspace/hk-roadbook");
    expect(inferWorkspaceProjectPath({ cwd: "/Users/test/.openclaw/workspace/hk-roadbook" }))
      .toBe("/Users/test/.openclaw/workspace/hk-roadbook");
    expect(inferWorkspaceProjectPath({ command: "cd ~/.openclaw/workspace/hk-roadbook && npm install" }))
      .toBe(path.join(os.homedir(), ".openclaw/workspace/hk-roadbook"));
  });

  it("does not recursively gate plugin recovery runs", () => {
    expect(isReactArtifactRequest(`${RECOVERY_MARKER}\nContinue the React app build`)).toBe(false);
  });
});

describe("local artifact verification", () => {
  it("rejects a failed production build", async () => {
    const root = await fixture("process.exit(7);\n");
    const result = await verifyLocalArtifact({ projectPath: root, allowedRoots: [root] });
    expect(result).toMatchObject({ ok: false, failedStage: "build" });
  });

  it("requires a fresh dist entry", async () => {
    const root = await fixture("console.log('no output');\n");
    const result = await verifyLocalArtifact({ projectPath: root, allowedRoots: [root] });
    expect(result).toMatchObject({ ok: false, failedStage: "entry" });
  });

  it("rejects runtime network APIs before building", async () => {
    const root = await fixture(
      "import fs from 'node:fs'; fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/index.html', '<main>ok</main>');\n",
      "fetch('https://example.com/api');\n",
    );
    const result = await verifyLocalArtifact({ projectPath: root, allowedRoots: [root] });
    expect(result).toMatchObject({ ok: false, failedStage: "runtime-network" });
  });

  it("accepts a local build and invalidates proof after a source edit", async () => {
    const root = await fixture(
      "import fs from 'node:fs'; fs.mkdirSync('dist/assets', { recursive: true }); fs.writeFileSync('dist/assets/app.js', 'console.log(1)'); fs.writeFileSync('dist/index.html', '<script src=\"./assets/app.js\"></script><main>ok</main>');\n",
    );
    const result = await verifyLocalArtifact({ projectPath: root, allowedRoots: [root] });
    expect(result.ok).toBe(true);
    expect(await verificationStillCurrent(result)).toEqual({ ok: true });

    await fs.appendFile(path.join(root, "src", "main.js"), "export const changed = true;\n");
    await expect(verificationStillCurrent(result)).resolves.toMatchObject({ ok: false });
  });
});
