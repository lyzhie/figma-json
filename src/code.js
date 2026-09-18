"use strict";

const SCREEN_TYPES = new Set(["FRAME", "COMPONENT", "INSTANCE"]);
const VISUAL_ASSET_TYPES = new Set([
  "RECTANGLE",
  "ELLIPSE",
  "LINE",
  "POLYGON",
  "STAR",
  "VECTOR",
  "BOOLEAN_OPERATION",
]);

figma.showUI(__html__, {
  width: 420,
  height: 500,
  themeColors: true,
  title: "Figma JSON",
});

function isVisible(node) {
  return !("visible" in node) || node.visible !== false;
}

function isScreenNode(node) {
  return SCREEN_TYPES.has(node.type) && isVisible(node);
}

function absolutePosition(node) {
  if (!("absoluteTransform" in node)) return { x: 0, y: 0 };
  return {
    x: node.absoluteTransform[0][2],
    y: node.absoluteTransform[1][2],
  };
}

function sortScreens(nodes) {
  return [...nodes].sort((left, right) => {
    const a = absolutePosition(left);
    const b = absolutePosition(right);
    return a.y - b.y || a.x - b.x || left.name.localeCompare(right.name);
  });
}

function pageScreenRoots(page) {
  const roots = [];
  for (const child of page.children) {
    if (!isVisible(child)) continue;
    if (isScreenNode(child)) {
      roots.push(child);
      continue;
    }
    if (child.type === "SECTION") {
      for (const sectionChild of child.children) {
        if (isScreenNode(sectionChild)) roots.push(sectionChild);
      }
    }
  }
  return sortScreens(roots);
}

function containingScreen(node) {
  let current = node;
  while (current && current.parent) {
    if (
      isScreenNode(current) &&
      (current.parent.type === "PAGE" || current.parent.type === "SECTION")
    ) {
      return current;
    }
    if (current.parent.type === "PAGE") break;
    current = current.parent;
  }
  return null;
}

function selectedScreenRoots(page) {
  const found = new Map();

  for (const selected of page.selection) {
    if (selected.type === "SECTION") {
      for (const child of selected.children) {
        if (isScreenNode(child)) found.set(child.id, child);
      }
      continue;
    }

    const root = containingScreen(selected);
    if (root) found.set(root.id, root);
  }

  return sortScreens(found.values());
}

function currentState() {
  const page = figma.currentPage;
  return {
    type: "STATE",
    pageName: page.name,
    selectedCount: selectedScreenRoots(page).length,
    pageCount: pageScreenRoots(page).length,
  };
}

function postState() {
  figma.ui.postMessage(currentState());
}

function round(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : value;
}

function simpleValue(value, depth) {
  const currentDepth = depth || 0;
  if (value === figma.mixed) return "MIXED";
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return typeof value === "number" ? round(value) : value;
  }
  if (currentDepth >= 6) return "[MAX_DEPTH]";
  if (Array.isArray(value)) {
    return value.map((entry) => simpleValue(entry, currentDepth + 1));
  }
  if (typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== "function") {
        output[key] = simpleValue(entry, currentDepth + 1);
      }
    }
    return output;
  }
  return String(value);
}

function colorHex(color) {
  if (!color || typeof color !== "object") return null;
  return `#${[color.r, color.g, color.b]
    .map((channel) =>
      Math.round(Math.max(0, Math.min(1, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

function paintSummary(paint) {
  if (!paint || paint.visible === false) return null;
  const output = { type: paint.type };
  if ("opacity" in paint && paint.opacity !== undefined) {
    output.opacity = round(paint.opacity);
  }
  if ("color" in paint) output.color = colorHex(paint.color);
  if ("scaleMode" in paint) output.scaleMode = paint.scaleMode;
  if ("gradientStops" in paint) {
    output.gradientStops = paint.gradientStops.map((stop) => ({
      position: round(stop.position),
      color: colorHex(stop.color),
      opacity: round(stop.color.a),
    }));
  }
  return output;
}

function surfaceSummary(node) {
  const output = {};

  if ("fills" in node) {
    if (node.fills === figma.mixed) {
      output.fills = "MIXED";
    } else if (Array.isArray(node.fills)) {
      const fills = node.fills.map(paintSummary).filter(Boolean);
      if (fills.length) output.fills = fills;
    }
  }

  if ("strokes" in node) {
    if (node.strokes === figma.mixed) {
      output.strokes = "MIXED";
    } else if (Array.isArray(node.strokes)) {
      const strokes = node.strokes.map(paintSummary).filter(Boolean);
      if (strokes.length) output.strokes = strokes;
    }
  }

  if ("strokeWeight" in node && node.strokeWeight !== figma.mixed && node.strokeWeight) {
    output.strokeWeight = round(node.strokeWeight);
  }

  if (
    "cornerRadius" in node &&
    node.cornerRadius !== figma.mixed &&
    node.cornerRadius !== 0
  ) {
    output.cornerRadius = round(node.cornerRadius);
  }

  if ("opacity" in node && node.opacity !== 1) output.opacity = round(node.opacity);

  if ("effects" in node && Array.isArray(node.effects)) {
    const effects = node.effects
      .filter((effect) => effect.visible !== false)
      .map((effect) => {
        const summary = { type: effect.type };
        if ("radius" in effect) summary.radius = round(effect.radius);
        if ("spread" in effect) summary.spread = round(effect.spread);
        if ("offset" in effect) summary.offset = simpleValue(effect.offset);
        if ("color" in effect) {
          summary.color = colorHex(effect.color);
          summary.opacity = round(effect.color.a);
        }
        return summary;
      });
    if (effects.length) output.effects = effects;
  }

  return Object.keys(output).length ? output : null;
}

function relativeBounds(node, screen) {
  const nodeX = node.absoluteTransform[0][2];
  const nodeY = node.absoluteTransform[1][2];
  const screenX = screen.absoluteTransform[0][2];
  const screenY = screen.absoluteTransform[1][2];
  const x = nodeX - screenX;
  const y = nodeY - screenY;
  const width = node.width;
  const height = node.height;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    widthRatio: round(width / screen.width),
    heightRatio: round(height / screen.height),
    horizontal:
      centerX < screen.width / 3
        ? "left"
        : centerX > (screen.width * 2) / 3
          ? "right"
          : "center",
    vertical:
      centerY < screen.height / 3
        ? "top"
        : centerY > (screen.height * 2) / 3
          ? "bottom"
          : "middle",
  };
}

function layoutSummary(node) {
  if (!("layoutMode" in node)) return null;
  if (node.layoutMode === "NONE") return { mode: "FREEFORM" };

  return {
    mode: node.layoutMode,
    wrap: "layoutWrap" in node ? node.layoutWrap : undefined,
    primaryAlign:
      "primaryAxisAlignItems" in node ? node.primaryAxisAlignItems : undefined,
    counterAlign:
      "counterAxisAlignItems" in node ? node.counterAxisAlignItems : undefined,
    gap: "itemSpacing" in node ? round(node.itemSpacing) : undefined,
    padding:
      "paddingTop" in node
        ? {
            top: round(node.paddingTop),
            right: round(node.paddingRight),
            bottom: round(node.paddingBottom),
            left: round(node.paddingLeft),
          }
        : undefined,
    sizing:
      "layoutSizingHorizontal" in node
        ? {
            horizontal: node.layoutSizingHorizontal,
            vertical: node.layoutSizingVertical,
          }
        : undefined,
  };
}

function normalizeAction(action) {
  return simpleValue(action);
}

function normalizeReactions(node) {
  if (!("reactions" in node) || !node.reactions.length) return [];
  return node.reactions.map((reaction) => ({
    trigger: simpleValue(reaction.trigger),
    actions: (reaction.actions || (reaction.action ? [reaction.action] : [])).map(
      normalizeAction,
    ),
  }));
}

function visibleInstanceText(instance) {
  return [
    ...new Set(
      instance
        .findAllWithCriteria({ types: ["TEXT"] })
        .filter((text) => isVisible(text) && text.characters.trim())
        .map((text) => text.characters.trim()),
    ),
  ];
}

async function serializeNode(node, screen, parentId, depth, order) {
  const base = {
    id: node.id,
    parentId,
    depth,
    order,
    name: node.name,
    nodeType: node.type,
    bounds: relativeBounds(node, screen),
  };

  const layout = layoutSummary(node);
  const surface = surfaceSummary(node);
  if (layout) base.layout = layout;
  if (surface) base.surface = surface;

  if (node.type === "TEXT" || node.type === "TEXT_PATH") {
    base.kind = "text";
    base.text = node.characters;
    base.typography = {
      fontName: simpleValue(node.fontName),
      fontSize: simpleValue(node.fontSize),
      fontWeight: simpleValue(node.fontWeight),
      lineHeight: simpleValue(node.lineHeight),
      letterSpacing: simpleValue(node.letterSpacing),
      alignHorizontal: node.textAlignHorizontal,
      alignVertical: node.textAlignVertical,
      textCase: node.textCase,
      decoration: node.textDecoration,
    };
    return base;
  }

  if (node.type === "INSTANCE") {
    base.kind = "component-instance";
    const mainComponent = await node.getMainComponentAsync();
    base.component = {
      id: mainComponent ? mainComponent.id : null,
      name: mainComponent ? mainComponent.name : null,
      setName:
        mainComponent &&
        mainComponent.parent &&
        mainComponent.parent.type === "COMPONENT_SET"
          ? mainComponent.parent.name
          : null,
      properties: Object.fromEntries(
        Object.entries(node.componentProperties).map(([key, property]) => [
          key,
          simpleValue(property.value),
        ]),
      ),
    };
    const text = visibleInstanceText(node);
    if (text.length) base.visibleText = text;
    return base;
  }

  if ("children" in node) {
    base.kind = "container";
    return base;
  }

  base.kind = VISUAL_ASSET_TYPES.has(node.type) ? "visual-asset" : "node";
  return base;
}

function regionKind(node) {
  if (node.type === "INSTANCE") return "component-instance";
  if ("children" in node) return "content-region";
  if (VISUAL_ASSET_TYPES.has(node.type)) return "visual-asset";
  return "node";
}

async function serializeScreen(screen, page) {
  const containers = [];
  const elements = [];
  const interactions = [];

  async function walk(node, parentId, depth, order) {
    if (!isVisible(node)) return;

    const serialized = await serializeNode(node, screen, parentId, depth, order);
    if (serialized.kind === "container") containers.push(serialized);
    else elements.push(serialized);

    const reactions = normalizeReactions(node);
    if (reactions.length) {
      interactions.push({
        sourceNodeId: node.id,
        sourceNodeName: node.name,
        sourceVisibleText:
          node.type === "TEXT" || node.type === "TEXT_PATH"
            ? [node.characters]
            : node.type === "INSTANCE"
              ? visibleInstanceText(node)
              : [],
        reactions,
      });
    }

    if (node.type !== "INSTANCE" && "children" in node) {
      for (let index = 0; index < node.children.length; index += 1) {
        await walk(node.children[index], node.id, depth + 1, index);
      }
    }
  }

  await walk(screen, null, 0, 0);

  const readingOrder = elements
    .filter(
      (element) =>
        (element.kind === "text" && element.text && element.text.trim()) ||
        (Array.isArray(element.visibleText) && element.visibleText.length),
    )
    .sort(
      (left, right) =>
        left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x,
    )
    .map((element) => element.id);

  const startingPoint = page.flowStartingPoints.find(
    (point) => point.nodeId === screen.id,
  );

  return {
    schemaVersion: "0.1",
    sourceData: {
      fileKey: figma.fileKey || null,
      fileName: figma.root.name,
      pageId: page.id,
      pageName: page.name,
      screenNodeId: screen.id,
      screenNodeName: screen.name,
    },
    screen: {
      id: screen.id,
      name: screen.name,
      nodeType: screen.type,
      size: { width: round(screen.width), height: round(screen.height) },
      clipsContent: "clipsContent" in screen ? screen.clipsContent : null,
      rootLayout: layoutSummary(screen),
      surface: surfaceSummary(screen),
    },
    flowContext: {
      isStartingPoint: Boolean(startingPoint),
      startingPointName: startingPoint ? startingPoint.name : null,
      incomingEdgeCount: 0,
      outgoingEdgeCount: 0,
    },
    regions:
      "children" in screen
        ? screen.children.filter(isVisible).map((node, index) => ({
            id: node.id,
            name: node.name,
            nodeType: node.type,
            kind: regionKind(node),
            order: index,
            bounds: relativeBounds(node, screen),
            layout: layoutSummary(node),
          }))
        : [],
    readingOrder,
    containers,
    elements,
    interactions,
    designerIntent: {
      status: "not-provided-by-source",
      userGoal: null,
      primaryQuestion: null,
      constraints: [],
      discussionQuestions: [],
    },
  };
}

function collectNodeActions(actions, path, output) {
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const actionPath = [...path, index];
    if (action.type === "NODE") {
      output.push({ action, path: actionPath });
      continue;
    }
    if (action.type === "CONDITIONAL" && Array.isArray(action.conditionalBlocks)) {
      for (let blockIndex = 0; blockIndex < action.conditionalBlocks.length; blockIndex += 1) {
        const block = action.conditionalBlocks[blockIndex];
        collectNodeActions(
          Array.isArray(block.actions) ? block.actions : [],
          [...actionPath, "conditionalBlocks", blockIndex, "actions"],
          output,
        );
      }
    }
  }
}

async function resolveExportedScreenId(destinationId, exportedIds) {
  if (!destinationId) return null;
  if (exportedIds.has(destinationId)) return destinationId;

  const destination = await figma.getNodeByIdAsync(destinationId);
  let current = destination;
  while (current) {
    if (exportedIds.has(current.id)) return current.id;
    current = current.parent;
  }
  return null;
}

async function buildEdges(screenDocuments) {
  const exportedIds = new Set(screenDocuments.map((document) => document.screen.id));
  const edges = [];

  for (const document of screenDocuments) {
    for (const interaction of document.interactions) {
      for (const reaction of interaction.reactions) {
        const nodeActions = [];
        collectNodeActions(reaction.actions || [], [], nodeActions);

        for (const entry of nodeActions) {
          const destinationNodeId = entry.action.destinationId || null;
          edges.push({
            id: `edge-${edges.length + 1}`,
            sourceScreenId: document.screen.id,
            sourceNodeId: interaction.sourceNodeId,
            sourceNodeName: interaction.sourceNodeName,
            sourceVisibleText: interaction.sourceVisibleText,
            trigger: reaction.trigger,
            actionPath: entry.path,
            action: entry.action,
            destinationNodeId,
            destinationScreenId: await resolveExportedScreenId(
              destinationNodeId,
              exportedIds,
            ),
          });
        }
      }
    }
  }

  return edges;
}

function reachableFrom(startId, edges) {
  const visited = new Set([startId]);
  const queue = [startId];

  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.sourceScreenId !== current || !edge.destinationScreenId) continue;
      if (!visited.has(edge.destinationScreenId)) {
        visited.add(edge.destinationScreenId);
        queue.push(edge.destinationScreenId);
      }
    }
  }
  return visited;
}

function buildFlows(page, screenDocuments, edges) {
  const includedIds = new Set(screenDocuments.map((document) => document.screen.id));
  const flows = [];

  for (const startingPoint of page.flowStartingPoints) {
    if (!includedIds.has(startingPoint.nodeId)) continue;
    const reachable = reachableFrom(startingPoint.nodeId, edges);
    flows.push({
      id: `flow-${startingPoint.nodeId.replace(/:/g, "-")}`,
      name: startingPoint.name,
      startingScreenId: startingPoint.nodeId,
      screenIds: screenDocuments
        .map((document) => document.screen.id)
        .filter((id) => reachable.has(id)),
      edgeIds: edges
        .filter(
          (edge) =>
            reachable.has(edge.sourceScreenId) &&
            (!edge.destinationScreenId || reachable.has(edge.destinationScreenId)),
        )
        .map((edge) => edge.id),
    });
  }
  return flows;
}

function applyFlowCounts(screenDocuments, edges) {
  for (const document of screenDocuments) {
    document.flowContext.incomingEdgeCount = edges.filter(
      (edge) => edge.destinationScreenId === document.screen.id,
    ).length;
    document.flowContext.outgoingEdgeCount = edges.filter(
      (edge) => edge.sourceScreenId === document.screen.id,
    ).length;
  }
}

function buildDiagnostics(screenDocuments, edges, flows) {
  const issues = [];
  const byName = new Map();

  for (const document of screenDocuments) {
    const existing = byName.get(document.screen.name) || [];
    existing.push(document.screen.id);
    byName.set(document.screen.name, existing);
  }

  for (const [name, nodeIds] of byName) {
    if (nodeIds.length > 1) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_SCREEN_NAME",
        message: `Multiple exported screens are named '${name}'. Stable node IDs are used as identity.`,
        nodeIds,
      });
    }
  }

  const genericContainers = screenDocuments.flatMap((document) =>
    document.containers.filter((container) => /^Frame(?:\s|$)/.test(container.name)),
  );
  if (genericContainers.length) {
    issues.push({
      severity: "warning",
      code: "GENERIC_CONTAINER_NAMES",
      message: `${genericContainers.length} exported layout containers use generic Frame names, which limits semantic discussion without vision.`,
      examples: genericContainers.slice(0, 5).map((container) => ({
        id: container.id,
        name: container.name,
      })),
    });
  }

  const unresolved = edges.filter(
    (edge) => edge.destinationNodeId && !edge.destinationScreenId,
  );
  if (unresolved.length) {
    issues.push({
      severity: "warning",
      code: "DESTINATION_OUTSIDE_EXPORT",
      message: `${unresolved.length} Prototype destinations are outside the exported screen set.`,
      edgeIds: unresolved.map((edge) => edge.id),
    });
  }

  const starts = new Set(flows.map((flow) => flow.startingScreenId));
  const noIncoming = screenDocuments
    .filter(
      (document) =>
        document.flowContext.incomingEdgeCount === 0 && !starts.has(document.screen.id),
    )
    .map((document) => document.screen.id);
  if (noIncoming.length) {
    issues.push({
      severity: "warning",
      code: "SCREEN_WITHOUT_INCOMING_FLOW",
      message: `${noIncoming.length} screens are neither a flow starting point nor the destination of an exported edge.`,
      nodeIds: noIncoming,
    });
  }

  const terminalScreenIds = screenDocuments
    .filter((document) => document.flowContext.outgoingEdgeCount === 0)
    .map((document) => document.screen.id);

  issues.push({
    severity: "info",
    code: "TERMINAL_SCREENS",
    message: `${terminalScreenIds.length} exported screens have no outgoing Prototype edge.`,
    nodeIds: terminalScreenIds,
  });
  issues.push({
    severity: "info",
    code: "DESIGN_INTENT_NOT_EXPORTED",
    message:
      "Figma structure describes what is present but does not declare the user goal, design rationale, or business rules.",
  });
  issues.push({
    severity: "info",
    code: "NO_VISION_DEPENDENCY",
    message:
      "This export contains no screenshot or rendered image. Layout is represented by hierarchy, relative bounds, Auto Layout, styles, and reading order.",
  });

  return {
    schemaVersion: "0.1",
    summary: {
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      info: issues.filter((issue) => issue.severity === "info").length,
    },
    issues,
  };
}

function safeSlug(value) {
  const slug = String(value || "figma-json")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "figma-json";
}

function screenFileName(screenId) {
  return `${screenId.replace(/[^a-zA-Z0-9._-]+/g, "-")}.json`;
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function createExport(mode) {
  const page = figma.currentPage;
  const roots = mode === "selection" ? selectedScreenRoots(page) : pageScreenRoots(page);

  if (!roots.length) {
    throw new Error(
      mode === "selection"
        ? "Select at least one screen, a child inside a screen, or a Section containing screens."
        : "No visible top-level screen Frames, Components, or Instances were found on this page.",
    );
  }

  figma.ui.postMessage({
    type: "EXPORT_PROGRESS",
    message: `Serializing ${roots.length} screen${roots.length === 1 ? "" : "s"}…`,
  });

  const screenDocuments = [];
  for (let index = 0; index < roots.length; index += 1) {
    figma.ui.postMessage({
      type: "EXPORT_PROGRESS",
      message: `Reading screen ${index + 1} of ${roots.length}: ${roots[index].name}`,
    });
    screenDocuments.push(await serializeScreen(roots[index], page));
  }

  const edges = await buildEdges(screenDocuments);
  const flows = buildFlows(page, screenDocuments, edges);
  applyFlowCounts(screenDocuments, edges);
  const diagnostics = buildDiagnostics(screenDocuments, edges, flows);
  const exportedAt = new Date().toISOString();

  const manifest = {
    schemaVersion: "0.1",
    exportKind: "figma-design-context",
    source: {
      type: "figma",
      fileKey: figma.fileKey || null,
      fileName: figma.root.name,
      pageId: page.id,
      pageName: page.name,
      exportedAt,
    },
    exportScope: {
      type: mode === "selection" ? "selected-screens" : "current-page-screens",
      screenCount: screenDocuments.length,
      flowCount: flows.length,
      edgeCount: edges.length,
    },
    screens: screenDocuments.map((document) => ({
      id: document.screen.id,
      name: document.screen.name,
      file: `screens/${screenFileName(document.screen.id)}`,
      width: document.screen.size.width,
      height: document.screen.size.height,
      isFlowStartingPoint: document.flowContext.isStartingPoint,
      flowStartingPointName: document.flowContext.startingPointName,
    })),
    files: {
      flows: "flows.json",
      diagnostics: "diagnostics.json",
    },
    capabilities: {
      nodeHierarchy: true,
      relativeGeometry: true,
      autoLayout: true,
      visibleText: true,
      typography: true,
      componentInstances: true,
      componentVariants: true,
      prototypeConnections: true,
      visualImages: false,
      html: false,
      designerIntent: false,
    },
    fieldPolicy: {
      extractedFacts: [
        "node IDs and names",
        "hierarchy",
        "bounds",
        "Auto Layout properties",
        "visible text",
        "typography",
        "component and variant references",
        "fills, strokes, radii, and effects",
        "prototype reactions",
      ],
      derivedFields: ["region kind", "relative position labels", "reading order"],
      notInferred: [
        "user goal",
        "design rationale",
        "business rules",
        "image contents",
        "visual quality",
      ],
    },
    readingStrategy: [
      "Read manifest.json first.",
      "Read flows.json to understand screen relationships.",
      "Read only the relevant screens/*.json files for a design discussion.",
      "Treat extracted fields as Figma facts and derived fields as exporter classifications.",
      "Do not invent missing visual or product intent.",
    ],
  };

  const flowsDocument = {
    schemaVersion: "0.1",
    source: {
      type: "figma-prototype",
      pageId: page.id,
      pageName: page.name,
    },
    flows,
    edges,
    terminalScreenIds: screenDocuments
      .filter((document) => document.flowContext.outgoingEdgeCount === 0)
      .map((document) => document.screen.id),
    unresolvedDestinationNodeIds: [
      ...new Set(
        edges
          .filter((edge) => edge.destinationNodeId && !edge.destinationScreenId)
          .map((edge) => edge.destinationNodeId),
      ),
    ],
  };

  const files = [
    { path: "manifest.json", content: prettyJson(manifest) },
    { path: "flows.json", content: prettyJson(flowsDocument) },
    { path: "diagnostics.json", content: prettyJson(diagnostics) },
    ...screenDocuments.map((document) => ({
      path: `screens/${screenFileName(document.screen.id)}`,
      content: prettyJson(document),
    })),
  ];

  const filename = `${safeSlug(figma.root.name)}-${safeSlug(page.name)}-${mode}-figma-json.zip`;
  return {
    files,
    filename,
    summary: {
      screenCount: screenDocuments.length,
      flowCount: flows.length,
      edgeCount: edges.length,
      warningCount: diagnostics.summary.warnings,
    },
  };
}

figma.ui.onmessage = async (message) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "READY") {
    postState();
    return;
  }

  if (message.type === "EXPORT") {
    try {
      const mode = message.mode === "page" ? "page" : "selection";
      const result = await createExport(mode);
      figma.ui.postMessage({ type: "DOWNLOAD_ZIP", ...result });
    } catch (error) {
      figma.ui.postMessage({
        type: "ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

figma.on("selectionchange", postState);
postState();
