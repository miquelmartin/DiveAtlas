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
import { filterDives } from "./view-model.js";

const state = {
  dives: [],
  mappings: [],
  selectedDives: new Set(),
  selectedMappings: new Set(),
  selectedViewDive: null,
  cancelled: false,
  mapInitialized: false,
};

const elements = Object.fromEntries(
  [
    "source-files",
    "drop-zone",
    "import-button",
    "cancel-import",
    "import-progress-wrap",
    "import-progress",
    "import-status",
    "import-count",
    "import-results",
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
    initializeMap(elements.map);
    state.mapInitialized = true;
    renderView();
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

function renderImportResults(results) {
  elements["import-results"].replaceChildren();
  const summary = document.createElement("p");
  const failures = results.filter((result) => result.type === "error").length;
  summary.textContent = `${results.length} file(s) processed${failures ? ` · ${failures} failed` : ""}.`;
  const list = document.createElement("ul");
  list.className = "result-list";
  results.forEach((result) => {
    appendResult(list, result.type, result.filename, result.message);
    result.issues.forEach((issue) => appendResult(list, "warning", result.filename, issue));
  });
  elements["import-results"].append(summary, list);
}

async function handleImport() {
  const files = [...elements["source-files"].files];
  if (!files.length) {
    elements["import-results"].textContent = "Choose at least one UDDF or CSV file.";
    return;
  }
  state.cancelled = false;
  elements["import-button"].disabled = true;
  elements["cancel-import"].disabled = false;
  elements["import-progress-wrap"].hidden = false;
  elements["import-progress"].max = files.length;
  const outcome = await importSources(files, {
    mappingMode: selectedRadio("mapping-mode"),
    isCancelled: () => state.cancelled,
    onProgress: (index, name, status = {}) => {
      elements["import-progress"].value = index;
      elements["import-count"].textContent = name
        ? `${Math.min(index + 1, files.length)} / ${files.length}`
        : `${index} / ${files.length}`;
      elements["import-status"].textContent = name
        ? `Processing ${name}`
        : status.cancelled
          ? "Import cancelled"
          : "Import complete";
    },
  });
  renderImportResults(outcome.results);
  elements["import-button"].disabled = false;
  elements["cancel-import"].disabled = true;
  await refreshLibrary();
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

async function selectViewDive(id) {
  state.selectedViewDive = id;
  const dive = state.dives.find((item) => item.id === id);
  if (!dive) return;
  const profile = await getRecord("profiles", id);
  const description = document.createElement("p");
  description.textContent = `${dive.site}, ${dive.location}`;
  const list = document.createElement("dl");
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
    list.append(wrapper);
  });
  elements["dive-detail"].replaceChildren(description, list);
  renderProfileChart(elements["profile-chart"], profile?.samples ?? []);
  renderView();
}

function renderView() {
  setSelectOptions(elements["location-filter"], state.dives.map((dive) => dive.location), "locations");
  const location = elements["location-filter"].value;
  setSelectOptions(
    elements["site-filter"],
    state.dives.filter((dive) => !location || dive.location === location).map((dive) => dive.site),
    "sites",
  );
  const dives = currentViewDives();
  elements["view-result-count"].textContent = `${dives.length} dive${dives.length === 1 ? "" : "s"}`;
  elements["view-dive-list"].replaceChildren();
  dives.forEach((dive) => {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("is-selected", dive.id === state.selectedViewDive);
    const title = document.createElement("strong");
    title.textContent = `Dive ${dive.number ?? "—"} · ${dive.site}`;
    const meta = document.createElement("small");
    meta.textContent = `${dive.dateTime?.slice(0, 10) || "Unknown date"} · ${dive.location} · ${
      isMatched(dive) ? "Mapped" : "Unmatched"
    }`;
    button.append(title, meta);
    button.addEventListener("click", () => selectViewDive(dive.id));
    elements["view-dive-list"].append(button);
  });
  if (!dives.length) {
    const message = document.createElement("p");
    message.textContent = "No dives match these filters.";
    elements["view-dive-list"].append(message);
  }

  const lookup = mappingLookup();
  const groups = new Map();
  dives.forEach((dive) => {
    const mapping = lookup.get(dive.mappingKey);
    if (!mapping) return;
    if (!groups.has(mapping.key)) groups.set(mapping.key, { mapping, dives: [] });
    groups.get(mapping.key).dives.push(dive);
  });
  renderMap([...groups.values()]);
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
  renderSummary();
  renderDiveTable();
  renderMappingTable();
  renderView();
  updateRemovalButtons();
  await updateStorageStatus();
}

function registerEvents() {
  document.querySelectorAll("[data-workspace]").forEach((button) =>
    button.addEventListener("click", () => setWorkspace(button.dataset.workspace)),
  );
  elements["import-button"].addEventListener("click", handleImport);
  elements["cancel-import"].addEventListener("click", () => {
    state.cancelled = true;
    elements["import-status"].textContent = "Cancelling after current file…";
  });
  ["dragenter", "dragover"].forEach((eventName) =>
    elements["drop-zone"].addEventListener(eventName, (event) => {
      event.preventDefault();
      elements["drop-zone"].classList.add("is-dragging");
    }),
  );
  ["dragleave", "drop"].forEach((eventName) =>
    elements["drop-zone"].addEventListener(eventName, (event) => {
      event.preventDefault();
      elements["drop-zone"].classList.remove("is-dragging");
    }),
  );
  elements["drop-zone"].addEventListener("drop", (event) => {
    elements["source-files"].files = event.dataTransfer.files;
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
  ["location-filter", "site-filter", "date-from", "date-to"].forEach((id) =>
    elements[id].addEventListener("change", renderView),
  );
  elements["view-search"].addEventListener("input", renderView);
  elements["clear-filters"].addEventListener("click", () => {
    ["location-filter", "site-filter", "date-from", "date-to", "view-search"].forEach(
      (id) => (elements[id].value = ""),
    );
    renderView();
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
  elements["import-results"].textContent = `DiveAtlas could not start: ${error.message}`;
});
