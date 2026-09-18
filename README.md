# Figma JSON

Figma JSON is a local Figma Design plugin that exports design context for text-only AI environments. It does not use screenshots, HTML, MCP, external APIs, or network requests.

## Export modes

1. **Selected screens** — exports screen roots represented by the current selection. Selecting a child promotes it to the containing top-level screen. Selecting a Section exports the screen roots directly inside that Section.
2. **All screens on this page** — exports visible Frame, Component, and Instance roots directly on the current Page or directly inside a Section.

Both modes download one ZIP containing:

```text
manifest.json
flows.json
diagnostics.json
screens/<figma-node-id>.json
```

The ZIP contains hierarchy, relative geometry, Auto Layout, visible text, typography, component instances and variants, surface styles, reading order, and Prototype reactions. It deliberately does not infer user goals, product rationale, business rules, image contents, or visual quality.

## Build and validate

No dependency installation is required.

```bash
npm run build
npm test
```

Runtime files are generated under `dist/`.

## Load in Figma Desktop

1. Open Figma Desktop.
2. Open a Figma Design file.
3. Choose **Plugins → Development → Import plugin from manifest…**.
4. Select this project's `manifest.json`.
5. Run **Figma JSON** from **Plugins → Development**.

The manifest uses a local placeholder ID. If Figma requires an assigned development ID in your organization, create a new local plugin from Figma's **New plugin** dialog and replace `manifest.json`'s `id` with the generated ID.

## Screen detection boundary

"All screens" is intentionally structural, not visual: top-level Frames, Components, and Instances count as screens. Design-system masters placed directly on the Page may therefore be included. Use **Selected screens** when a Page mixes product screens and library assets.
