"use strict";

const FigmaJsonFlowGraph = (() => {
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

  function hasCycle(startId, edges) {
    const outgoing = new Map();
    for (const edge of edges) {
      const existing = outgoing.get(edge.sourceScreenId) || [];
      existing.push(edge.destinationScreenId);
      outgoing.set(edge.sourceScreenId, existing);
    }

    const visiting = new Set();
    const visited = new Set();

    function visit(screenId) {
      if (visiting.has(screenId)) return true;
      if (visited.has(screenId)) return false;
      visiting.add(screenId);
      for (const destinationId of outgoing.get(screenId) || []) {
        if (visit(destinationId)) return true;
      }
      visiting.delete(screenId);
      visited.add(screenId);
      return false;
    }

    return visit(startId);
  }

  function transitionFromEdge(edge, screenNames) {
    return {
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      sourceNodeName: edge.sourceNodeName,
      visibleText: edge.sourceVisibleText,
      trigger: edge.trigger,
      action: edge.action,
      navigation: edge.action && edge.action.navigation ? edge.action.navigation : null,
      destinationNodeId: edge.destinationNodeId,
      destinationScreenId: edge.destinationScreenId,
      destinationScreenName: edge.destinationScreenId
        ? screenNames.get(edge.destinationScreenId) || null
        : null,
    };
  }

  function classifyGraph(startId, screenIds, flowEdges) {
    const resolvedEdges = flowEdges.filter((edge) => edge.destinationScreenId);
    if (flowEdges.some((edge) => !edge.destinationScreenId)) return "incomplete";
    if (hasCycle(startId, resolvedEdges)) return "cyclic";
    if (screenIds.length === 1 && resolvedEdges.length === 0) return "single-screen";

    const incomingCounts = new Map(screenIds.map((id) => [id, 0]));
    const outgoingCounts = new Map(screenIds.map((id) => [id, 0]));
    for (const edge of resolvedEdges) {
      outgoingCounts.set(edge.sourceScreenId, outgoingCounts.get(edge.sourceScreenId) + 1);
      incomingCounts.set(
        edge.destinationScreenId,
        incomingCounts.get(edge.destinationScreenId) + 1,
      );
    }

    const isLinear =
      resolvedEdges.length === screenIds.length - 1 &&
      screenIds.every((id) =>
        id === startId
          ? incomingCounts.get(id) === 0
          : incomingCounts.get(id) === 1,
      ) &&
      screenIds.filter((id) => outgoingCounts.get(id) === 0).length === 1 &&
      screenIds.every((id) => outgoingCounts.get(id) <= 1);

    return isLinear ? "linear" : "branching";
  }

  function orderedLinearScreens(startId, outgoingEdges) {
    const ordered = [startId];
    const visited = new Set(ordered);
    let current = startId;

    while (outgoingEdges.get(current) && outgoingEdges.get(current).length === 1) {
      const destinationId = outgoingEdges.get(current)[0].destinationScreenId;
      if (visited.has(destinationId)) break;
      ordered.push(destinationId);
      visited.add(destinationId);
      current = destinationId;
    }
    return ordered;
  }

  function buildFlows(page, screenDocuments, edges) {
    const includedIds = new Set(screenDocuments.map((document) => document.screen.id));
    const screenNames = new Map(
      screenDocuments.map((document) => [document.screen.id, document.screen.name]),
    );
    const flows = [];

    for (const startingPoint of page.flowStartingPoints) {
      if (!includedIds.has(startingPoint.nodeId)) continue;
      const reachable = reachableFrom(startingPoint.nodeId, edges);
      const screenIds = screenDocuments
        .map((document) => document.screen.id)
        .filter((id) => reachable.has(id));
      const flowEdges = edges.filter(
        (edge) =>
          reachable.has(edge.sourceScreenId) &&
          (!edge.destinationScreenId || reachable.has(edge.destinationScreenId)),
      );
      const resolvedEdges = flowEdges.filter((edge) => edge.destinationScreenId);
      const outgoingEdges = new Map(screenIds.map((id) => [id, []]));
      const incomingEdgeIds = new Map(screenIds.map((id) => [id, []]));

      for (const edge of flowEdges) {
        outgoingEdges.get(edge.sourceScreenId).push(edge);
        if (edge.destinationScreenId) {
          incomingEdgeIds.get(edge.destinationScreenId).push(edge.id);
        }
      }

      const graphType = classifyGraph(startingPoint.nodeId, screenIds, flowEdges);
      const flow = {
        id: `flow-${startingPoint.nodeId.replace(/:/g, "-")}`,
        name: startingPoint.name,
        startingScreenId: startingPoint.nodeId,
        graphType,
        screenIds,
        screenIdsSemantics:
          "reachable screens in export order; not guaranteed to be journey order",
        edgeIds: flowEdges.map((edge) => edge.id),
        transitionsByScreen: Object.fromEntries(
          screenIds.map((screenId) => [
            screenId,
            {
              screenId,
              screenName: screenNames.get(screenId) || null,
              incomingEdgeIds: incomingEdgeIds.get(screenId),
              outgoingTransitions: outgoingEdges
                .get(screenId)
                .map((edge) => transitionFromEdge(edge, screenNames)),
            },
          ]),
        ),
        terminalScreenIds: screenIds.filter(
          (screenId) => outgoingEdges.get(screenId).length === 0,
        ),
      };

      if (graphType === "linear") {
        flow.orderedScreenIds = orderedLinearScreens(
          startingPoint.nodeId,
          outgoingEdges,
        );
        flow.steps = flow.orderedScreenIds.slice(0, -1).map((screenId, index) => {
          const edge = outgoingEdges.get(screenId)[0];
          return {
            step: index + 1,
            from: {
              screenId,
              screenName: screenNames.get(screenId) || null,
            },
            interaction: {
              edgeId: edge.id,
              sourceNodeId: edge.sourceNodeId,
              sourceNodeName: edge.sourceNodeName,
              visibleText: edge.sourceVisibleText,
              trigger: edge.trigger,
              action: edge.action,
              navigation:
                edge.action && edge.action.navigation ? edge.action.navigation : null,
            },
            to: {
              screenId: edge.destinationScreenId,
              screenName: screenNames.get(edge.destinationScreenId) || null,
            },
          };
        });
      }

      flows.push(flow);
    }
    return flows;
  }

  return { buildFlows };
})();
