import {
  getAll,
  getRecord,
  openDatabase,
  removeDives,
  removeMappings,
} from "./db.js";
import { createBackup, restoreBackup } from "./backup.js";
import { importSources } from "./importer.js";
import { initializeMap, renderMap } from "./map.js";
import { renderProfileChart } from "./profile-chart.js";
import { downloadJson, formatBytes } from "./utils.js";
import { filterDives, filterDivesToBounds } from "./view-model.js";

const state = {
  dives: [],
  mappings: [],
  selectedDives: new Set(),
  selectedMappings: new Set(),
  selectedViewDives: new Set(),
  mapBounds: null,
  cancelled: false,
  mapInitialized: false,
  pendingDiveFiles: [],
  pendingCoordinateFile: null,
  diveImporting: false,
  coordinateImporting: false,
  profileRenderVersion: 0,
};

const elements = Object.fromEntries(
  [
    "dive-files",
    "dive-drop-zone",
    "dive-selection-status",
    "cancel-dive-import",
    "dive-progress-wrap",
    "dive-import-progress",
    "dive-import-status",
    "dive-import-count",
    "dive-import-results",
    "coordinate-file",
    "coordinate-drop-zone",
    "coordinate-selection-status",
    "coordinate-import-results",
    "dive-count",
    "mapped-count",
    "unmatched-count",
    "mapping-count",
    "dive-search",
    "dive-table-body",
    "dive-empty",
    "select-all-dives",
    "remove-dives",
    "mapping-search",
    "mapping-table-body",
    "mapping-empty",
    "select-all-mappings",
    "remove-mappings",
    "unmatched-list",
    "storage-usage",
    "persistence-status",
    "request-persistence",
    "download-backup",
    "backup-file",
    "restore-backup",
    "backup-status",
    "location-filter",
    "site-filter",
    "date-from",
    "date-to",
    "view-search",
    "clear-filters",
    "reset-map-filter",
    "view-result-count",
    "view-dive-list",
    "dive-detail",
    "profile-chart",
    "map",
  ].map((id) => [id, document.getElementById(id)]),
);

function selectedRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function setWorkspace(name) {
  document.querySelectorAll(".workspace").forEach((workspace) => {
    workspace.hidden = workspace.id !== `${name}-workspace`;
  });
  document.querySelectorAll("[data-workspace]").forEach((button) => {
    const selected = button.dataset.workspace === name;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", selected);
  });
  if (name === "view") setTimeout(() => globalThis.dispatchEvent(new Event("resize")), 0);
  if (name === "view" && !state.mapInitialized) {
    initializeMap(elements.map, {
      onBoundsChange: (bounds) => {
        state.mapBounds = bounds;
        renderView({ updateMap: false });
      },
      onMarkerSelect: (ids) => void toggleViewDives(ids),
    });
    state.mapInitialized = true;
    state.mapBounds = null;
    renderView({ fitMap: true });
  }
}

function mappingLookup() {
  return new Map(state.mappings.map((mapping) => [mapping.key, mapping]));
}

function isMatched(dive, lookup = mappingLookup()) {
  return lookup.has(dive.mappingKey);
}

function appendResult(list, type, filename, message) {
  const item = document.createElement("li");
  item.className = type;
  const name = document.createElement("strong");
  name.textContent = filename;
  item.append(name, document.createTextNode(` — ${message}`));
  list.append(item);
}

function renderImportResults(target, results) {
  target.replaceChildren();
  const summary = document.createElement("p");
  const failures = results.filter((result) => result.type === "error").length;
  summary.textContent = `${results.length} file(s) processed${failures ? ` · ${failures} failed` : ""}.`;
  const list = document.createElement("ul");
  list.className = "result-list";
  results.forEach((result) => {
    appendResult(list, result.type, result.filename, result.message);
    result.issues.forEach((issue) => appendResult(list, "warning", result.filename, issue));
  });
  target.append(summary, list);
}

function diveSelectionText(files, rejected = 0) {
  if (!files.length) {
    return rejected
      ? `${rejected} file(s) ignored. Dive files must end in .uddf.`
      : "No dive files selected.";
  }
  const visibleNames = files.slice(0, 3).map((file) => file.name).join(", ");
  const additional = files.length > 3 ? ` and ${files.length - 3} more` : "";
  const ignored = rejected ? ` · ${rejected} non-UDDF file(s) ignored` : "";
  return `${files.length} dive file${files.length === 1 ? "" : "s"} selected: ${visibleNames}${additional}${ignored}`;
}

function setDiveFiles(fileList) {
  const files = [...fileList];
  state.pendingDiveFiles = files.filter((file) => file.name.toLowerCase().endsWith(".uddf"));
  elements["dive-selection-status"].textContent = diveSelectionText(
    state.pendingDiveFiles,
    files.length - state.pendingDiveFiles.length,
  );
}

function setCoordinateFiles(fileList) {
  const files = [...fileList];
  const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
  state.pendingCoordinateFile = csvFiles[0] ?? null;
  const ignored = files.length - (state.pendingCoordinateFile ? 1 : 0);
  elements["coordinate-selection-status"].textContent = state.pendingCoordinateFile
    ? `${state.pendingCoordinateFile.name} selected${
        ignored ? ` · ${ignored} additional or non-CSV file(s) ignored` : ""
      }`
    : files.length
      ? `${files.length} file(s) ignored. Coordinate files must end in .csv.`
      : "No coordinate file selected.";
}

function registerDropZone(zone, onFiles) {
  ["dragenter", "dragover"].forEach((eventName) =>
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    }),
  );
  ["dragleave", "drop"].forEach((eventName) =>
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
    }),
  );
  zone.addEventListener("drop", (event) => onFiles(event.dataTransfer.files));
}

async function handleDiveImport() {
  if (state.diveImporting) {
    elements["dive-selection-status"].textContent =
      "A dive import is already running. Drop these files again when it completes.";
    return;
  }
  const files = [...state.pendingDiveFiles];
  if (!files.length) {
    elements["dive-import-results"].textContent = "Choose at least one .uddf dive file.";
    return;
  }
  state.cancelled = false;
  state.diveImporting = true;
  setDiveFiles(files);
  elements["dive-files"].disabled = true;
  elements["cancel-dive-import"].disabled = false;
  elements["dive-progress-wrap"].hidden = false;
  elements["dive-import-progress"].max = files.length;
  try {
    const outcome = await importSources(files, {
      isCancelled: () => state.cancelled,
      onProgress: (index, name, status = {}) => {
        elements["dive-import-progress"].value = index;
        elements["dive-import-count"].textContent = name
          ? `${Math.min(index + 1, files.length)} / ${files.length}`
          : `${index} / ${files.length}`;
        elements["dive-import-status"].textContent = name
          ? `Processing ${name}`
          : status.cancelled
            ? "Dive import cancelled"
            : "Dive import complete";
      },
    });
    renderImportResults(elements["dive-import-results"], outcome.results);
    await refreshLibrary();
  } catch (error) {
    elements["dive-import-results"].textContent =
      `Dive import failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.diveImporting = false;
    elements["dive-files"].disabled = false;
    elements["cancel-dive-import"].disabled = true;
    setDiveFiles(files);
  }
}

async function handleCoordinateImport() {
  if (state.coordinateImporting) {
    elements["coordinate-selection-status"].textContent =
      "A coordinate import is already running. Choose the file again when it completes.";
    return;
  }
  const file = state.pendingCoordinateFile;
  if (!file) {
    elements["coordinate-import-results"].textContent = "Choose one coordinate CSV file.";
    return;
  }
  state.coordinateImporting = true;
  setCoordinateFiles([file]);
  elements["coordinate-file"].disabled = true;
  elements["coordinate-selection-status"].textContent = `Importing ${file.name}…`;
  try {
    const outcome = await importSources([file], {
      mappingMode: selectedRadio("mapping-mode"),
    });
    renderImportResults(elements["coordinate-import-results"], outcome.results);
    await refreshLibrary();
  } catch (error) {
    elements["coordinate-import-results"].textContent =
      `Coordinate import failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.coordinateImporting = false;
    elements["coordinate-file"].disabled = false;
    setCoordinateFiles([file]);
  }
}

function filteredDivesForTable() {
  const query = elements["dive-search"].value.trim().toLowerCase();
  if (!query) return state.dives;
  return state.dives.filter((dive) =>
    [dive.number, dive.dateTime, dive.location, dive.site, dive.region]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function filteredMappingsForTable() {
  const query = elements["mapping-search"].value.trim().toLowerCase();
  if (!query) return state.mappings;
  return state.mappings.filter((mapping) =>
    [mapping.location, mapping.site, mapping.confidence].join(" ").toLowerCase().includes(query),
  );
}

function cell(row, value) {
  const item = document.createElement("td");
  item.textContent = value;
  row.append(item);
}

function renderDiveTable() {
  const dives = filteredDivesForTable();
  const lookup = mappingLookup();
  elements["dive-table-body"].replaceChildren();
  dives.forEach((dive) => {
    const row = document.createElement("tr");
    const selection = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedDives.has(dive.id);
    checkbox.setAttribute("aria-label", `Select dive ${dive.number ?? dive.id}`);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? state.selectedDives.add(dive.id) : state.selectedDives.delete(dive.id);
      updateRemovalButtons();
    });
    selection.append(checkbox);
    row.append(selection);
    cell(row, dive.number ?? "—");
    cell(row, dive.dateTime ? new Date(dive.dateTime).toLocaleDateString() : "Unknown");
    cell(row, `${dive.location} / ${dive.site}`);
    cell(row, Number.isFinite(dive.maxDepth) ? `${dive.maxDepth.toFixed(1)} m` : "—");
    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    const matched = isMatched(dive, lookup);
    status.className = `status ${matched ? "matched" : "unmatched"}`;
    status.textContent = matched ? "Mapped" : "Unmatched";
    statusCell.append(status);
    row.append(statusCell);
    elements["dive-table-body"].append(row);
  });
  elements["dive-empty"].hidden = dives.length > 0;
  elements["select-all-dives"].checked =
    dives.length > 0 && dives.every((dive) => state.selectedDives.has(dive.id));
}

function renderMappingTable() {
  const mappings = filteredMappingsForTable();
  elements["mapping-table-body"].replaceChildren();
  mappings.forEach((mapping) => {
    const row = document.createElement("tr");
    const selection = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedMappings.has(mapping.key);
    checkbox.setAttribute("aria-label", `Select ${mapping.location} / ${mapping.site}`);
    checkbox.addEventListener("change", () => {
      checkbox.checked
        ? state.selectedMappings.add(mapping.key)
        : state.selectedMappings.delete(mapping.key);
      updateRemovalButtons();
    });
    selection.append(checkbox);
    row.append(selection);
    cell(row, mapping.location);
    cell(row, mapping.site);
    cell(row, mapping.latitude.toFixed(5));
    cell(row, mapping.longitude.toFixed(5));
    cell(row, mapping.confidence);
    elements["mapping-table-body"].append(row);
  });
  elements["mapping-empty"].hidden = mappings.length > 0;
  elements["select-all-mappings"].checked =
    mappings.length > 0 && mappings.every((mapping) => state.selectedMappings.has(mapping.key));
}

function renderSummary() {
  const lookup = mappingLookup();
  const matched = state.dives.filter((dive) => isMatched(dive, lookup)).length;
  elements["dive-count"].textContent = state.dives.length;
  elements["mapped-count"].textContent = matched;
  elements["unmatched-count"].textContent = state.dives.length - matched;
  elements["mapping-count"].textContent = state.mappings.length;
  const unmatchedGroups = new Map();
  state.dives
    .filter((dive) => !isMatched(dive, lookup))
    .forEach((dive) => {
      const label = `${dive.location} / ${dive.site}`;
      unmatchedGroups.set(label, (unmatchedGroups.get(label) ?? 0) + 1);
    });
  elements["unmatched-list"].replaceChildren();
  if (!unmatchedGroups.size) {
    const item = document.createElement("li");
    item.textContent = state.dives.length ? "All imported dives are matched." : "No dives imported.";
    elements["unmatched-list"].append(item);
  } else {
    [...unmatchedGroups.entries()].forEach(([label, count]) => {
      const item = document.createElement("li");
      item.textContent = `${label} (${count})`;
      elements["unmatched-list"].append(item);
    });
  }
}

function setSelectOptions(select, values, label) {
  const current = select.value;
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = `All ${label}`;
  select.append(all);
  [...new Set(values.filter(Boolean))].sort().forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function currentViewDives() {
  return filterDives(state.dives, {
    location: elements["location-filter"].value,
    site: elements["site-filter"].value,
    from: elements["date-from"].value,
    to: elements["date-to"].value,
    search: elements["view-search"].value,
  });
}

async function renderSelectedDiveDetails() {
  const renderVersion = ++state.profileRenderVersion;
  const dives = state.dives.filter((dive) => state.selectedViewDives.has(dive.id));
  if (!dives.length) {
    elements["dive-detail"].innerHTML = "<p>Select one or more dives to compare profiles.</p>";
    renderProfileChart(elements["profile-chart"], []);
    return;
  }
  const description = document.createElement("p");
  description.textContent =
    dives.length === 1
      ? `${dives[0].site}, ${dives[0].location}`
      : `${dives.length} dives selected for profile comparison`;
  const detailsElement = dives.length === 1 ? document.createElement("dl") : document.createElement("ul");
  if (dives.length === 1) {
    const dive = dives[0];
    const details = [
      ["Dive", dive.number ?? "—"],
      ["Date", dive.dateTime ? new Date(dive.dateTime).toLocaleString() : "Unknown"],
      ["Maximum depth", Number.isFinite(dive.maxDepth) ? `${dive.maxDepth.toFixed(1)} m` : "—"],
      ["Duration", Number.isFinite(dive.durationSeconds) ? `${Math.round(dive.durationSeconds / 60)} min` : "—"],
      ["Computer", [dive.computer.manufacturer, dive.computer.model].filter(Boolean).join(" ") || "Unknown"],
      ["Decompression", dive.decompression.model || "Unknown"],
      ["Gradient factors", Number.isFinite(dive.decompression.gfLow) ? `${dive.decompression.gfLow}/${dive.decompression.gfHigh}` : "—"],
      ["Samples", dive.sampleCount],
    ];
    details.forEach(([term, value]) => {
      const wrapper = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value;
      wrapper.append(dt, dd);
      detailsElement.append(wrapper);
    });
  } else {
    detailsElement.className = "selected-dive-summary";
    dives.forEach((dive) => {
      const item = document.createElement("li");
      item.textContent = `Dive ${dive.number ?? "—"} · ${dive.site} · ${
        Number.isFinite(dive.maxDepth) ? `${dive.maxDepth.toFixed(1)} m` : "unknown depth"
      }`;
      detailsElement.append(item);
    });
  }
  elements["dive-detail"].replaceChildren(description, detailsElement);
  const profiles = await Promise.all(
    dives.map(async (dive) => ({
      label: `Dive ${dive.number ?? "—"} · ${dive.site}`,
      samples: (await getRecord("profiles", dive.id))?.samples ?? [],
    })),
  );
  if (renderVersion !== state.profileRenderVersion) return;
  renderProfileChart(elements["profile-chart"], profiles);
}

async function toggleViewDives(ids) {
  const allSelected = ids.every((id) => state.selectedViewDives.has(id));
  ids.forEach((id) =>
    allSelected ? state.selectedViewDives.delete(id) : state.selectedViewDives.add(id),
  );
  await renderSelectedDiveDetails();
  renderView({ updateMap: false });
}

function renderView({ updateMap = true, fitMap = false } = {}) {
  setSelectOptions(elements["location-filter"], state.dives.map((dive) => dive.location), "locations");
  const location = elements["location-filter"].value;
  setSelectOptions(
    elements["site-filter"],
    state.dives.filter((dive) => !location || dive.location === location).map((dive) => dive.site),
    "sites",
  );
  const baseDives = currentViewDives();
  const lookup = mappingLookup();
  const dives = filterDivesToBounds(baseDives, lookup, state.mapBounds);
  elements["view-result-count"].textContent = state.mapBounds
    ? `${dives.length} of ${baseDives.length} dives in map view`
    : `${dives.length} dive${dives.length === 1 ? "" : "s"}`;
  elements["reset-map-filter"].disabled = !state.mapBounds;
  elements["view-dive-list"].replaceChildren();
  dives.forEach((dive) => {
    const button = document.createElement("button");
    button.type = "button";
    const selected = state.selectedViewDives.has(dive.id);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected);
    const title = document.createElement("strong");
    title.textContent = `Dive ${dive.number ?? "—"} · ${dive.site}`;
    const meta = document.createElement("small");
    meta.textContent = `${dive.dateTime?.slice(0, 10) || "Unknown date"} · ${dive.location} · ${
      isMatched(dive) ? "Mapped" : "Unmatched"
    }`;
    button.append(title, meta);
    button.addEventListener("click", () => void toggleViewDives([dive.id]));
    elements["view-dive-list"].append(button);
  });
  if (!dives.length) {
    const message = document.createElement("p");
    message.textContent = "No dives match these filters.";
    elements["view-dive-list"].append(message);
  }

  const groups = new Map();
  baseDives.forEach((dive) => {
    const mapping = lookup.get(dive.mappingKey);
    if (!mapping) return;
    if (!groups.has(mapping.key)) groups.set(mapping.key, { mapping, dives: [] });
    groups.get(mapping.key).dives.push(dive);
  });
  if (updateMap) renderMap([...groups.values()], { fit: fitMap });
}

function updateRemovalButtons() {
  elements["remove-dives"].disabled = state.selectedDives.size === 0;
  elements["remove-mappings"].disabled = state.selectedMappings.size === 0;
}

async function updateStorageStatus() {
  if (!navigator.storage) {
    elements["storage-usage"].textContent = "Not reported by this browser";
    elements["persistence-status"].textContent = "Not supported";
    elements["request-persistence"].disabled = true;
    return;
  }
  const estimate = await navigator.storage.estimate();
  elements["storage-usage"].textContent = `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`;
  elements["persistence-status"].textContent = (await navigator.storage.persisted())
    ? "Persistent"
    : "Best effort";
}

async function refreshLibrary() {
  [state.dives, state.mappings] = await Promise.all([getAll("dives"), getAll("mappings")]);
  state.dives.sort((a, b) => (b.dateTime || "").localeCompare(a.dateTime || ""));
  state.mappings.sort((a, b) =>
    `${a.location}\u001f${a.site}`.localeCompare(`${b.location}\u001f${b.site}`),
  );
  const diveIds = new Set(state.dives.map((dive) => dive.id));
  state.selectedViewDives = new Set(
    [...state.selectedViewDives].filter((id) => diveIds.has(id)),
  );
  state.mapBounds = null;
  renderSummary();
  renderDiveTable();
  renderMappingTable();
  renderView({ fitMap: state.mapInitialized });
  await renderSelectedDiveDetails();
  updateRemovalButtons();
  await updateStorageStatus();
}

function registerEvents() {
  document.querySelectorAll("[data-workspace]").forEach((button) =>
    button.addEventListener("click", () => setWorkspace(button.dataset.workspace)),
  );
  elements["dive-files"].addEventListener("change", (event) => {
    setDiveFiles(event.target.files);
    if (state.pendingDiveFiles.length) void handleDiveImport();
  });
  elements["coordinate-file"].addEventListener("change", (event) => {
    setCoordinateFiles(event.target.files);
    if (state.pendingCoordinateFile) void handleCoordinateImport();
  });
  elements["cancel-dive-import"].addEventListener("click", () => {
    state.cancelled = true;
    elements["dive-import-status"].textContent = "Cancelling after current file…";
  });
  registerDropZone(elements["dive-drop-zone"], (files) => {
    setDiveFiles(files);
    if (state.pendingDiveFiles.length) void handleDiveImport();
  });
  registerDropZone(elements["coordinate-drop-zone"], (files) => {
    setCoordinateFiles(files);
    if (state.pendingCoordinateFile) void handleCoordinateImport();
  });
  elements["dive-search"].addEventListener("input", renderDiveTable);
  elements["mapping-search"].addEventListener("input", renderMappingTable);
  elements["select-all-dives"].addEventListener("change", (event) => {
    filteredDivesForTable().forEach((dive) =>
      event.target.checked ? state.selectedDives.add(dive.id) : state.selectedDives.delete(dive.id),
    );
    renderDiveTable();
    updateRemovalButtons();
  });
  elements["select-all-mappings"].addEventListener("change", (event) => {
    filteredMappingsForTable().forEach((mapping) =>
      event.target.checked
        ? state.selectedMappings.add(mapping.key)
        : state.selectedMappings.delete(mapping.key),
    );
    renderMappingTable();
    updateRemovalButtons();
  });
  elements["remove-dives"].addEventListener("click", async () => {
    if (!confirm(`Remove ${state.selectedDives.size} selected dive(s) and profile samples?`)) return;
    await removeDives([...state.selectedDives]);
    state.selectedDives.clear();
    await refreshLibrary();
  });
  elements["remove-mappings"].addEventListener("click", async () => {
    if (!confirm(`Remove ${state.selectedMappings.size} selected mapping(s)?`)) return;
    await removeMappings([...state.selectedMappings]);
    state.selectedMappings.clear();
    await refreshLibrary();
  });
  elements["request-persistence"].addEventListener("click", async () => {
    const granted = await navigator.storage.persist();
    elements["persistence-status"].textContent = granted ? "Persistent" : "Best effort";
  });
  elements["download-backup"].addEventListener("click", async () => {
    const backup = await createBackup();
    downloadJson(`diveatlas-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
  });
  elements["backup-file"].addEventListener("change", () => {
    elements["restore-backup"].disabled = !elements["backup-file"].files.length;
  });
  elements["restore-backup"].addEventListener("click", async () => {
    const file = elements["backup-file"].files[0];
    const mode = selectedRadio("restore-mode");
    if (mode === "replace" && !confirm("Replace the entire local DiveAtlas library?")) return;
    try {
      const result = await restoreBackup(JSON.parse(await file.text()), mode);
      elements["backup-status"].textContent = `${result.addedDives} dive(s) and ${result.addedMappings} mapping(s) restored${
        result.conflicts.length ? `; ${result.conflicts.length} conflict(s) retained` : ""
      }.`;
      await refreshLibrary();
    } catch (error) {
      elements["backup-status"].textContent = error instanceof Error ? error.message : String(error);
    }
  });
  const applyViewFilters = () => {
    state.mapBounds = null;
    renderView({ fitMap: true });
  };
  ["location-filter", "site-filter", "date-from", "date-to"].forEach((id) =>
    elements[id].addEventListener("change", applyViewFilters),
  );
  elements["view-search"].addEventListener("input", applyViewFilters);
  elements["clear-filters"].addEventListener("click", () => {
    ["location-filter", "site-filter", "date-from", "date-to", "view-search"].forEach(
      (id) => (elements[id].value = ""),
    );
    state.mapBounds = null;
    renderView({ fitMap: true });
  });
  elements["reset-map-filter"].addEventListener("click", () => {
    state.mapBounds = null;
    renderView({ fitMap: true });
  });
}

async function start() {
  await openDatabase();
  registerEvents();
  await refreshLibrary();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(new URL("../sw.js", import.meta.url));
  }
}

start().catch((error) => {
  elements["dive-import-results"].textContent = `DiveAtlas could not start: ${error.message}`;
});
