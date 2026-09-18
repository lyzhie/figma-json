import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(projectRoot, "src/flow-graph.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox);
new vm.Script(`${source}\n;globalThis.__flowGraph = FigmaJsonFlowGraph;`, {
  filename: "src/flow-graph.js",
}).runInContext(sandbox);

const { buildFlows } = sandbox.__flowGraph;

function screen(id, name = `Screen ${id}`) {
  return { screen: { id, name } };
}

function edge(id, from, to, label = id) {
  return {
    id,
    sourceScreenId: from,
    sourceNodeId: `${from}-control`,
    sourceNodeName: label,
    sourceVisibleText: [label],
    trigger: { type: "ON_CLICK" },
    action: {
      type: "NODE",
      destinationId: to,
      navigation: "NAVIGATE",
    },
    destinationNodeId: to,
    destinationScreenId: to,
  };
}

function flowFor(startId, screenDocuments, edges) {
  return buildFlows(
    { flowStartingPoints: [{ nodeId: startId, name: "Flow 1" }] },
    screenDocuments,
    edges,
  )[0];
}

const transferScreens = [
  screen("3:1016", "Conversational flow"),
  screen("11:1655", "Conversational flow"),
  screen("3:1480", "Conversational flow"),
];
const transferFlow = flowFor("3:1016", transferScreens, [
  edge("edge-1", "3:1016", "11:1655", "Continue"),
  edge("edge-2", "11:1655", "3:1480", "Confirm transfer"),
]);

assert.equal(transferFlow.graphType, "linear");
assert.deepEqual([...transferFlow.screenIds], ["3:1016", "11:1655", "3:1480"]);
assert.deepEqual([...transferFlow.edgeIds], ["edge-1", "edge-2"]);
assert.match(transferFlow.screenIdsSemantics, /export order/);
assert.deepEqual(
  [...transferFlow.orderedScreenIds],
  ["3:1016", "11:1655", "3:1480"],
);
assert.equal(transferFlow.steps.length, 2);
assert.equal(transferFlow.steps[1].interaction.edgeId, "edge-2");
assert.equal(transferFlow.steps[1].interaction.visibleText[0], "Confirm transfer");
assert.equal(transferFlow.steps[1].to.screenId, "3:1480");
assert.equal(
  transferFlow.transitionsByScreen["11:1655"].outgoingTransitions[0]
    .destinationScreenId,
  "3:1480",
);
assert.deepEqual([...transferFlow.terminalScreenIds], ["3:1480"]);

const nonJourneyExportOrderFlow = flowFor(
  "A",
  [screen("A"), screen("C"), screen("B")],
  [edge("edge-1", "A", "B"), edge("edge-2", "B", "C")],
);
assert.deepEqual([...nonJourneyExportOrderFlow.screenIds], ["A", "C", "B"]);
assert.deepEqual([...nonJourneyExportOrderFlow.orderedScreenIds], ["A", "B", "C"]);

const branchingFlow = flowFor(
  "A",
  [screen("A"), screen("B"), screen("C")],
  [edge("edge-1", "A", "B"), edge("edge-2", "A", "C")],
);
assert.equal(branchingFlow.graphType, "branching");
assert.equal("orderedScreenIds" in branchingFlow, false);

const cyclicFlow = flowFor(
  "A",
  [screen("A"), screen("B")],
  [edge("edge-1", "A", "B"), edge("edge-2", "B", "A")],
);
assert.equal(cyclicFlow.graphType, "cyclic");

const unresolvedEdge = edge("edge-1", "A", "outside");
unresolvedEdge.destinationScreenId = null;
const incompleteFlow = flowFor("A", [screen("A")], [unresolvedEdge]);
assert.equal(incompleteFlow.graphType, "incomplete");
assert.equal(incompleteFlow.terminalScreenIds.length, 0);
assert.equal(
  incompleteFlow.transitionsByScreen.A.outgoingTransitions[0].destinationScreenId,
  null,
);

const singleScreenFlow = flowFor("A", [screen("A")], []);
assert.equal(singleScreenFlow.graphType, "single-screen");
assert.deepEqual([...singleScreenFlow.terminalScreenIds], ["A"]);

process.stdout.write(
  "Flow graph regression tests passed: linear journey, branching, cyclic, incomplete, and single-screen.\n",
);
