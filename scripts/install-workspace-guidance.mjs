import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const START = "<!-- openclaw-webapp-kit:react-artifact:start -->";
const END = "<!-- openclaw-webapp-kit:react-artifact:end -->";
const [targetPath, templatePath] = process.argv.slice(2);

if (!targetPath || !templatePath) {
  throw new Error("Usage: node install-workspace-guidance.mjs <AGENTS.md> <template.md>");
}

const guidance = (await readFile(templatePath, "utf8")).trim();
if (!guidance.startsWith(START) || !guidance.endsWith(END)) {
  throw new Error("The guidance template must contain the expected managed-block markers");
}

let current = "";
let mode = 0o600;
try {
  current = await readFile(targetPath, "utf8");
  mode = (await stat(targetPath)).mode & 0o777;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const startIndex = current.indexOf(START);
const endIndex = current.indexOf(END);
let next;
if (startIndex >= 0 || endIndex >= 0) {
  if (startIndex < 0 || endIndex < startIndex) {
    throw new Error(`Malformed managed guidance block in ${targetPath}`);
  }
  next = `${current.slice(0, startIndex).trimEnd()}\n\n${guidance}${current.slice(endIndex + END.length)}`;
} else {
  const prefix = current.trimEnd();
  next = `${prefix ? `${prefix}\n\n` : ""}${guidance}\n`;
}

await mkdir(path.dirname(targetPath), { recursive: true });
const temporaryPath = `${targetPath}.openclaw-webapp-kit.tmp`;
await writeFile(temporaryPath, next, { mode });
await rename(temporaryPath, targetPath);
console.log(`Installed React artifact guidance in ${targetPath}`);
