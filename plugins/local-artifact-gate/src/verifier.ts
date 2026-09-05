import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const PROOF_FILE = ".openclaw-artifact-verification.json";
const FINGERPRINT_IGNORES = new Set([".git", "dist", "node_modules", PROOF_FILE]);
const SOURCE_EXTENSIONS = new Set([".css", ".html", ".js", ".jsx", ".json", ".mjs", ".ts", ".tsx"]);
const MAX_FINGERPRINT_FILES = 5_000;
const MAX_FINGERPRINT_BYTES = 64 * 1024 * 1024;
const OUTPUT_LIMIT = 16_000;

export type VerificationResult = {
  ok: boolean;
  projectPath: string;
  outputDir: string;
  entryPath?: string;
  manager?: string;
  checks: string[];
  failedStage?: string;
  error?: string;
  output?: string;
  fingerprint?: string;
  proofPath?: string;
};

export type VerificationOptions = {
  projectPath: string;
  allowedRoots?: string[];
  outputDir?: string;
  timeoutMs?: number;
  enforceNoRuntimeNetwork?: boolean;
  signal?: AbortSignal;
};

type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
};

type CommandResult = {
  code: number | null;
  output: string;
  timedOut: boolean;
};

function clipOutput(value: string): string {
  return value.length <= OUTPUT_LIMIT ? value : value.slice(-OUTPUT_LIMIT);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalPath(value: string): Promise<string> {
  return fs.realpath(path.resolve(value));
}

export function defaultAllowedRoots(): string[] {
  return [path.join(os.homedir(), ".openclaw", "workspace")];
}

async function assertAllowedProject(projectPath: string, roots: string[]): Promise<string> {
  const project = await canonicalPath(projectPath);
  const stat = await fs.stat(project);
  if (!stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${project}`);
  }

  const allowed = await Promise.all(roots.map(async (root) => {
    try {
      return await canonicalPath(root);
    } catch {
      return path.resolve(root);
    }
  }));
  if (!allowed.some((root) => isPathInside(root, project))) {
    throw new Error(`Project path is outside allowed roots: ${project}`);
  }
  return project;
}

function assertRelativeOutputDir(value: string): string {
  const normalized = path.normalize(value.trim() || "dist");
  if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Output directory must stay inside the project: ${value}`);
  }
  return normalized;
}

function packageManager(project: string, pkg: PackageJson): { command: string; argsFor: (script: string) => string[] } {
  const declared = pkg.packageManager?.split("@")[0];
  if (declared === "pnpm") return { command: "pnpm", argsFor: (script) => ["run", script] };
  if (declared === "yarn") return { command: "yarn", argsFor: (script) => [script] };
  if (declared === "bun") return { command: "bun", argsFor: (script) => ["run", script] };
  return {
    command: "npm",
    argsFor: (script) => ["run", script],
  };
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: "1" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer | string) => {
      output = clipOutput(output + chunk.toString());
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code, output: clipOutput(output), timedOut });
    });
  });
}

async function walkFiles(root: string, ignored: Set<string>): Promise<string[]> {
  const files: string[] = [];
  async function visit(current: string, relativeDir: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const relative = path.join(relativeDir, entry.name);
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        files.push(relative);
        if (files.length > MAX_FINGERPRINT_FILES) {
          throw new Error(`Project has more than ${MAX_FINGERPRINT_FILES} source files`);
        }
      }
    }
  }
  await visit(root, "");
  return files;
}

export async function fingerprintProject(projectPath: string): Promise<string> {
  const files = await walkFiles(projectPath, FINGERPRINT_IGNORES);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const relative of files) {
    const content = await fs.readFile(path.join(projectPath, relative));
    bytes += content.length;
    if (bytes > MAX_FINGERPRINT_BYTES) {
      throw new Error(`Project source exceeds ${MAX_FINGERPRINT_BYTES} bytes`);
    }
    hash.update(relative);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function scanRuntimeNetwork(projectPath: string): Promise<string[]> {
  const candidates: string[] = [];
  for (const rootName of ["src", "public"]) {
    const root = path.join(projectPath, rootName);
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const files = await walkFiles(root, new Set());
    candidates.push(...files.map((file) => path.join(rootName, file)));
  }
  if (await fs.stat(path.join(projectPath, "index.html")).then(() => true, () => false)) {
    candidates.push("index.html");
  }

  const patterns: Array<[string, RegExp]> = [
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["Supabase", /\b(?:supabase|createClient\s*\()/i],
    ["Axios runtime request", /\baxios\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(/i],
    ["remote runtime URL", /https?:\/\//i],
  ];
  const violations: string[] = [];
  for (const relative of candidates) {
    if (!SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
    const content = await fs.readFile(path.join(projectPath, relative), "utf8");
    for (const [label, pattern] of patterns) {
      if (pattern.test(content)) violations.push(`${relative}: ${label}`);
    }
  }
  return violations;
}

async function validateEntryAssets(outputPath: string): Promise<string[]> {
  const entry = path.join(outputPath, "index.html");
  const html = await fs.readFile(entry, "utf8");
  const missing: string[] = [];
  const refs = html.matchAll(/(?:src|href)=["']([^"']+)["']/gi);
  for (const match of refs) {
    const value = match[1].split(/[?#]/, 1)[0];
    if (!value || value.startsWith("data:") || value.startsWith("#")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
      missing.push(`external runtime asset: ${value}`);
      continue;
    }
    if (value.startsWith("/")) {
      missing.push(`root-absolute asset is not portable: ${value}`);
      continue;
    }
    const target = path.resolve(outputPath, value);
    if (!isPathInside(outputPath, target) || !(await fs.stat(target).then(() => true, () => false))) {
      missing.push(`missing local asset: ${value}`);
    }
  }
  return missing;
}

function failed(
  projectPath: string,
  outputDir: string,
  checks: string[],
  failedStage: string,
  error: string,
  output?: string,
  manager?: string,
): VerificationResult {
  return { ok: false, projectPath, outputDir, checks, failedStage, error, output, manager };
}

export async function verifyLocalArtifact(options: VerificationOptions): Promise<VerificationResult> {
  const outputDir = assertRelativeOutputDir(options.outputDir ?? "dist");
  const checks: string[] = [];
  let projectPath = path.resolve(options.projectPath);
  try {
    projectPath = await assertAllowedProject(projectPath, options.allowedRoots ?? defaultAllowedRoots());
  } catch (error) {
    return failed(projectPath, outputDir, checks, "path", error instanceof Error ? error.message : String(error));
  }

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(projectPath, "package.json"), "utf8")) as PackageJson;
  } catch (error) {
    return failed(projectPath, outputDir, checks, "package", `Cannot read package.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!pkg.scripts?.build) {
    return failed(projectPath, outputDir, checks, "package", "package.json must define scripts.build");
  }

  const manager = packageManager(projectPath, pkg);
  const timeoutMs = options.timeoutMs ?? 600_000;
  const typecheckScript = pkg.scripts["type-check"] ? "type-check" : pkg.scripts.typecheck ? "typecheck" : undefined;
  if (typecheckScript) {
    const result = await runCommand(manager.command, manager.argsFor(typecheckScript), projectPath, timeoutMs, options.signal);
    if (result.code !== 0) {
      return failed(projectPath, outputDir, checks, "typecheck", `${typecheckScript} failed${result.timedOut ? " (timed out)" : ""}`, result.output, manager.command);
    }
    checks.push(`${typecheckScript}: passed`);
  } else {
    checks.push("typecheck: skipped (no script)");
  }

  if (options.enforceNoRuntimeNetwork !== false) {
    const violations = await scanRuntimeNetwork(projectPath);
    if (violations.length > 0) {
      return failed(projectPath, outputDir, checks, "runtime-network", `Runtime networking or remote assets are forbidden:\n${violations.join("\n")}`, undefined, manager.command);
    }
    checks.push("runtime-network: clean");
  }

  const startedAt = Date.now();
  const build = await runCommand(manager.command, manager.argsFor("build"), projectPath, timeoutMs, options.signal);
  if (build.code !== 0) {
    return failed(projectPath, outputDir, checks, "build", `build failed${build.timedOut ? " (timed out)" : ""}`, build.output, manager.command);
  }
  checks.push("build: passed");

  const entryPath = path.join(projectPath, outputDir, "index.html");
  let entryStat;
  try {
    entryStat = await fs.stat(entryPath);
  } catch {
    return failed(projectPath, outputDir, checks, "entry", `Build succeeded but ${path.join(outputDir, "index.html")} is missing`, build.output, manager.command);
  }
  if (!entryStat.isFile() || entryStat.size === 0) {
    return failed(projectPath, outputDir, checks, "entry", `${path.join(outputDir, "index.html")} is empty or not a file`, build.output, manager.command);
  }
  if (entryStat.mtimeMs + 2_000 < startedAt) {
    return failed(projectPath, outputDir, checks, "entry", `${path.join(outputDir, "index.html")} was not refreshed by this build`, build.output, manager.command);
  }
  checks.push("dist entry: present and fresh");

  const assetProblems = await validateEntryAssets(path.join(projectPath, outputDir));
  if (assetProblems.length > 0) {
    return failed(projectPath, outputDir, checks, "assets", assetProblems.join("\n"), build.output, manager.command);
  }
  checks.push("entry assets: local and present");

  const fingerprint = await fingerprintProject(projectPath);
  const proofPath = path.join(projectPath, PROOF_FILE);
  const proof = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    projectPath,
    outputDir,
    entryPath,
    manager: manager.command,
    checks,
    fingerprint,
  };
  await fs.writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  return {
    ok: true,
    projectPath,
    outputDir,
    entryPath,
    manager: manager.command,
    checks,
    output: build.output,
    fingerprint,
    proofPath,
  };
}

export async function verificationStillCurrent(result: VerificationResult): Promise<{ ok: boolean; reason?: string }> {
  if (!result.ok || !result.fingerprint || !result.entryPath || !result.proofPath) {
    return { ok: false, reason: result.error ?? "No successful artifact verification is recorded" };
  }
  if (!(await fs.stat(result.entryPath).then((stat) => stat.isFile() && stat.size > 0, () => false))) {
    return { ok: false, reason: `Verified entry is missing: ${result.entryPath}` };
  }
  if (!(await fs.stat(result.proofPath).then((stat) => stat.isFile(), () => false))) {
    return { ok: false, reason: `Verification proof is missing: ${result.proofPath}` };
  }
  const current = await fingerprintProject(result.projectPath);
  if (current !== result.fingerprint) {
    return { ok: false, reason: "Project files changed after the successful build verification" };
  }
  return { ok: true };
}
