import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function checkScript(source, filename) {
  new vm.Script(source, { filename });
}

execFileSync(process.execPath, [path.join(projectRoot, "scripts/build.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});

const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "manifest.json"), "utf8"),
);

const requiredManifestFields = [
  "name",
  "id",
  "api",
  "main",
  "ui",
  "editorType",
  "documentAccess",
  "networkAccess",
];
for (const field of requiredManifestFields) {
  if (!(field in manifest)) throw new Error(`manifest.json is missing '${field}'.`);
}
if (manifest.name !== "Figma JSON") throw new Error("Unexpected plugin name.");
if (manifest.documentAccess !== "dynamic-page") {
  throw new Error("documentAccess must be dynamic-page.");
}
if (
  !Array.isArray(manifest.networkAccess.allowedDomains) ||
  manifest.networkAccess.allowedDomains.length !== 1 ||
  manifest.networkAccess.allowedDomains[0] !== "none"
) {
  throw new Error("The plugin must not request network access.");
}

const [sourceCode, uiSource, zipSource, builtCode, builtUi] = await Promise.all([
  readFile(path.join(projectRoot, "src/code.js"), "utf8"),
  readFile(path.join(projectRoot, "src/ui.js"), "utf8"),
  readFile(path.join(projectRoot, "src/zip.js"), "utf8"),
  readFile(path.join(projectRoot, manifest.main), "utf8"),
  readFile(path.join(projectRoot, manifest.ui), "utf8"),
]);

checkScript(sourceCode, "src/code.js");
checkScript(uiSource, "src/ui.js");
checkScript(zipSource, "src/zip.js");

if (sourceCode !== builtCode) throw new Error("dist/code.js is stale.");
if (builtUi.includes("<!-- ZIP_SCRIPT -->") || builtUi.includes("<!-- UI_SCRIPT -->")) {
  throw new Error("dist/ui.html still contains build placeholders.");
}
if (!builtUi.includes("FigmaJsonZip") || !builtUi.includes("DOWNLOAD_ZIP")) {
  throw new Error("dist/ui.html is missing required runtime code.");
}

const zipSandbox = {
  TextEncoder,
  Uint8Array,
  Uint32Array,
  ArrayBuffer,
  DataView,
  Date,
};
zipSandbox.globalThis = zipSandbox;
vm.createContext(zipSandbox);
new vm.Script(zipSource, { filename: "src/zip.js" }).runInContext(zipSandbox);

const zipBytes = zipSandbox.FigmaJsonZip.createZip(
  [
    { path: "manifest.json", content: "{\"ok\":true}\n" },
    { path: "screens/1-2.json", content: "{\"id\":\"1:2\"}\n" },
  ],
  new Date("2026-09-18T00:00:00Z"),
);

if (!(zipBytes instanceof Uint8Array) || zipBytes.length < 100) {
  throw new Error("ZIP writer returned an invalid byte array.");
}
if (
  zipBytes[0] !== 0x50 ||
  zipBytes[1] !== 0x4b ||
  zipBytes[2] !== 0x03 ||
  zipBytes[3] !== 0x04
) {
  throw new Error("ZIP writer returned an invalid local header signature.");
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "figma-json-test-"));
try {
  const zipPath = path.join(temporaryRoot, "export.zip");
  await writeFile(zipPath, zipBytes);
  execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const codeSize = (await stat(path.join(projectRoot, manifest.main))).size;
const uiSize = (await stat(path.join(projectRoot, manifest.ui))).size;
process.stdout.write(
  `Validation passed: manifest, JavaScript syntax, inline UI build, and ZIP integrity. Runtime ${codeSize + uiSize} bytes.\n`,
);
