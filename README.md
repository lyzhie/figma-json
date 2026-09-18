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

## Reading prototype flows

Each flow in `flows.json` keeps the compatibility fields `screenIds` and `edgeIds`, and also includes a `graphType`: `single-screen`, `linear`, `branching`, `cyclic`, or `incomplete`.

- `screenIds` is the set of reachable screens in export order. It is not guaranteed to be journey order.
- For a `linear` flow, use `orderedScreenIds` and `steps`. Each step embeds its source screen, interaction details, and destination screen, so no cross-array lookup is needed.
- For `branching`, `cyclic`, or `incomplete` flows, use `transitionsByScreen` and do not force the graph into a linear journey. Each reachable screen lists its incoming edge IDs and complete outgoing transitions.
- `terminalScreenIds` is included on every flow. An unresolved transition keeps a screen from being labeled terminal, and makes the flow `incomplete`.

Classification is conservative: an unresolved destination takes precedence as `incomplete`, then a detected cycle becomes `cyclic`; only a complete single chain is `linear`.

## Build and validate

No dependency installation is required.

```bash
npm run build
npm test
npm run package:release
```

Runtime files are generated under `dist/`. The release command rebuilds and validates the plugin, then writes `release/figma-json-plugin.zip` and verifies that its `dist/code.js` exactly matches the fresh build.

## Load in Figma Desktop

1. Open Figma Desktop.
2. Open a Figma Design file.
3. Choose **Plugins → Development → Import plugin from manifest…**.
4. Select this project's `manifest.json`.
5. Run **Figma JSON** from **Plugins → Development**.

The manifest uses a local placeholder ID. If Figma requires an assigned development ID in your organization, create a new local plugin from Figma's **New plugin** dialog and replace `manifest.json`'s `id` with the generated ID.

## Screen detection boundary

"All screens" is intentionally structural, not visual: top-level Frames, Components, and Instances count as screens. Design-system masters placed directly on the Page may therefore be included. Use **Selected screens** when a Page mixes product screens and library assets.
