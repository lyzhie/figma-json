import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(projectRoot, "release");
const archivePath = path.join(releaseRoot, "figma-json-plugin.zip");

execFileSync(process.execPath, [path.join(projectRoot, "scripts/validate.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});

await mkdir(releaseRoot, { recursive: true });
await rm(archivePath, { force: true });
execFileSync(
  "zip",
  ["-X", "-q", archivePath, "manifest.json", "README.md", "dist/code.js", "dist/ui.html"],
  { cwd: projectRoot },
);

const [builtCode, archivedCode] = await Promise.all([
  readFile(path.join(projectRoot, "dist/code.js")),
  Promise.resolve(execFileSync("unzip", ["-p", archivePath, "dist/code.js"])),
]);
if (!builtCode.equals(archivedCode)) {
  throw new Error("Release archive contains a stale dist/code.js.");
}

process.stdout.write(`Packaged and verified ${archivePath}\n`);
