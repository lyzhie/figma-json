(function startUi() {
  "use strict";

  const state = {
    mode: "selection",
    exporting: false,
    pageName: "Current page",
    selectedCount: 0,
    pageCount: 0,
  };

  const elements = {
    pageName: document.getElementById("page-name"),
    screenSummary: document.getElementById("screen-summary"),
    selectedOption: document.getElementById("selected-option"),
    pageOption: document.getElementById("page-option"),
    selectedCount: document.getElementById("selected-count"),
    pageCount: document.getElementById("page-count"),
    exportButton: document.getElementById("export-button"),
    status: document.getElementById("status"),
  };

  function send(message) {
    parent.postMessage({ pluginMessage: message }, "*");
  }

  function setStatus(message, tone) {
    elements.status.textContent = message || "";
    elements.status.className = `status${tone ? ` ${tone}` : ""}`;
  }

  function chooseMode(mode) {
    if (state.exporting) return;
    if (mode === "selection" && state.selectedCount === 0) return;

    state.mode = mode;
    elements.selectedOption.classList.toggle("selected", mode === "selection");
    elements.pageOption.classList.toggle("selected", mode === "page");
    elements.selectedOption.setAttribute("aria-checked", String(mode === "selection"));
    elements.pageOption.setAttribute("aria-checked", String(mode === "page"));
    updateControls();
  }

  function updateControls() {
    elements.pageName.textContent = state.pageName;
    elements.selectedCount.textContent = String(state.selectedCount);
    elements.pageCount.textContent = String(state.pageCount);
    elements.screenSummary.textContent = `${state.pageCount} screen${state.pageCount === 1 ? "" : "s"}`;

    elements.selectedOption.disabled = state.exporting || state.selectedCount === 0;
    elements.pageOption.disabled = state.exporting || state.pageCount === 0;

    if (state.selectedCount === 0 && state.mode === "selection") {
      state.mode = "page";
      elements.selectedOption.classList.remove("selected");
      elements.pageOption.classList.add("selected");
      elements.selectedOption.setAttribute("aria-checked", "false");
      elements.pageOption.setAttribute("aria-checked", "true");
    }

    const activeCount = state.mode === "selection" ? state.selectedCount : state.pageCount;
    elements.exportButton.disabled = state.exporting || activeCount === 0;
    elements.exportButton.textContent = state.exporting
      ? "Preparing ZIP…"
      : `Download ${activeCount || ""} screen${activeCount === 1 ? "" : "s"} as JSON ZIP`;
  }

  function safeFilename(filename) {
    return String(filename || "figma-json-export.zip")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function downloadZip(files, filename) {
    const bytes = globalThis.FigmaJsonZip.createZip(files);
    const blob = new Blob([bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeFilename(filename);
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return bytes.length;
  }

  elements.selectedOption.addEventListener("click", () => chooseMode("selection"));
  elements.pageOption.addEventListener("click", () => chooseMode("page"));

  elements.exportButton.addEventListener("click", () => {
    const count = state.mode === "selection" ? state.selectedCount : state.pageCount;
    if (count === 0 || state.exporting) return;
    state.exporting = true;
    updateControls();
    setStatus(`Reading ${count} screen${count === 1 ? "" : "s"} from Figma…`);
    send({ type: "EXPORT", mode: state.mode });
  });

  window.onmessage = (event) => {
    const message = event.data && event.data.pluginMessage;
    if (!message || typeof message.type !== "string") return;

    if (message.type === "STATE") {
      state.pageName = message.pageName || "Current page";
      state.selectedCount = Number(message.selectedCount || 0);
      state.pageCount = Number(message.pageCount || 0);
      updateControls();
      return;
    }

    if (message.type === "EXPORT_PROGRESS") {
      setStatus(message.message || "Preparing export…");
      return;
    }

    if (message.type === "DOWNLOAD_ZIP") {
      try {
        const zipSize = downloadZip(message.files, message.filename);
        const kb = Math.max(1, Math.round(zipSize / 1024));
        setStatus(
          `Downloaded ${message.summary.screenCount} screens, ${message.summary.edgeCount} flow edges · ${kb} KB`,
          "success",
        );
        send({ type: "DOWNLOAD_COMPLETE" });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), "error");
      } finally {
        state.exporting = false;
        updateControls();
      }
      return;
    }

    if (message.type === "ERROR") {
      state.exporting = false;
      updateControls();
      setStatus(message.message || "Export failed.", "error");
    }
  };

  updateControls();
  send({ type: "READY" });
})();
