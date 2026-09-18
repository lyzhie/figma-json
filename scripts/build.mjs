import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "src");
const outputRoot = path.join(projectRoot, "dist");

const [code, template, zipScript, uiScript] = await Promise.all([
  readFile(path.join(sourceRoot, "code.js"), "utf8"),
  readFile(path.join(sourceRoot, "ui.template.html"), "utf8"),
  readFile(path.join(sourceRoot, "zip.js"), "utf8"),
  readFile(path.join(sourceRoot, "ui.js"), "utf8"),
]);

if (!template.includes("<!-- ZIP_SCRIPT -->") || !template.includes("<!-- UI_SCRIPT -->")) {
  throw new Error("UI template is missing an inline script placeholder.");
}

const ui = template
  .replace("<!-- ZIP_SCRIPT -->", `<script>\n${zipScript}\n</script>`)
  .replace("<!-- UI_SCRIPT -->", `<script>\n${uiScript}\n</script>`);

await mkdir(outputRoot, { recursive: true });
await Promise.all([
  writeFile(path.join(outputRoot, "code.js"), code, "utf8"),
  writeFile(path.join(outputRoot, "ui.html"), ui, "utf8"),
]);

process.stdout.write(
  `Built dist/code.js (${Buffer.byteLength(code)} bytes) and dist/ui.html (${Buffer.byteLength(ui)} bytes)\n`,
);
