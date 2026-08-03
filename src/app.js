import {
  applyMappings,
  clearLibrary,
  getAll,
  getRecord,
  openDatabase,
  removeDives,
  removeMappings,
} from "./db.js";
import { createBackup, restoreBackup } from "./backup.js";
import { importSources } from "./importer.js";
import { enrichMappingCountry, UNASSIGNED_COUNTRY } from "./country.js";
import { initializeMap, renderMap, updateMapSelection } from "./map.js";
import { renderProfileChart } from "./profile-chart.js";
import { renderSelectionStatistics } from "./statistics-chart.js";
import { downloadJson, formatBytes, normalizeKey } from "./utils.js";
import {
  filterDives,
  filterDivesToBounds,
  sortDives,
} from "./view-model.js";

const state = {
  dives: [],
  mappings: [],
  selectedDives: new Set(),
  selectedMappings: new Set(),
  expandedMappingLocations: new Set(),
  selectedViewDives: new Set(),
  mapBounds: null,
  showOutsideMap: false,
  cancelled: false,
  mapInitialized: false,
  pendingDiveFiles: [],
  pendingCoordinateFile: null,
  diveImporting: false,
  coordinateImporting: false,
  profileRenderVersion: 0,
  dateValues: [],
  sortField: "number",
  sortDirection: "desc",
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
    "clear-all-data",
    "view-search",
    "min-depth",
    "min-duration",
    "date-range-start",
    "date-range-end",
    "date-range-track",
    "date-range-label",
    "clear-filters",
    "show-outside-map",
    "select-map-dives",
    "select-list-dives",
    "clear-view-dives",
    "view-result-count",
    "view-dive-list",
    "dive-detail",
    "selection-stats",
    "selection-empty",
    "profile-chart",
    "map",
    "app-menu-button",
    "app-menu-panel",
    "welcome-dialog",
    "close-welcome",
    "accept-welcome",
    "open-welcome-screenshot",
    "welcome-screenshot-dialog",
    "close-welcome-screenshot",
  ].map((id) => [id, document.getElementById(id)]),
);

function selectedRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function setAppMenuOpen(open, { focusButton = false } = {}) {
  elements["app-menu-panel"].hidden = !open;
  elements["app-menu-button"].setAttribute("aria-expanded", String(open));
  elements["app-menu-button"].setAttribute("aria-label", open ? "Close menu" : "Open menu");
  if (!open && focusButton) elements["app-menu-button"].focus();
}

function setWorkspace(name) {
  document.querySelectorAll(".workspace").forEach((workspace) => {
    workspace.hidden = workspace.id !== `${name}-workspace`;
  });
  document.querySelectorAll("[data-workspace]").forEach((button) => {
    const selected = button.dataset.workspace === name;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", selected);
  });
  document.getElementById("workspace").setAttribute("aria-busy", "false");
  if (name === "view") setTimeout(() => globalThis.dispatchEvent(new Event("resize")), 0);
  if (name === "view" && !state.mapInitialized) {
    initializeMap(elements.map, {
      onBoundsChange: (bounds) => {
        void handleMapBoundsChange(bounds);
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
  updateClearAllDataButton();
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
    updateClearAllDataButton();
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
  updateClearAllDataButton();
  setCoordinateFiles([file]);
  elements["coordinate-file"].disabled = true;
  elements["coordinate-selection-status"].textContent = `Importing ${file.name}…`;
  try {
    const outcome = await importSources([file], {
      mappingMode: "merge",
    });
    renderImportResults(elements["coordinate-import-results"], outcome.results);
    await refreshLibrary();
  } catch (error) {
    elements["coordinate-import-results"].textContent =
      `Coordinate import failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.coordinateImporting = false;
    updateClearAllDataButton();
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
    [mapping.location, mapping.site, mapping.country, mapping.confidence]
      .join(" ")
      .toLowerCase()
      .includes(query),
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
  const locations = new Map();
  mappings.forEach((mapping) => {
    const key = normalizeKey(mapping.location);
    if (!locations.has(key)) {
      locations.set(key, { location: mapping.location, mappings: [] });
    }
    locations.get(key).mappings.push(mapping);
  });
  [...locations.values()]
    .sort((left, right) => left.location.localeCompare(right.location))
    .forEach((group, groupIndex) => {
      group.mappings.sort((left, right) => left.site.localeCompare(right.site));
      const groupKey = normalizeKey(group.location);
      const expanded = state.expandedMappingLocations.has(groupKey);
      const locationRow = document.createElement("tr");
      locationRow.className = "mapping-location-row";
      const groupSelection = document.createElement("td");
      const groupCheckbox = document.createElement("input");
      groupCheckbox.type = "checkbox";
      const selectedCount = group.mappings.filter((mapping) =>
        state.selectedMappings.has(mapping.key),
      ).length;
      groupCheckbox.checked = selectedCount === group.mappings.length;
      groupCheckbox.indeterminate = selectedCount > 0 && selectedCount < group.mappings.length;
      groupCheckbox.setAttribute(
        "aria-label",
        `Select all ${group.mappings.length} sites in ${group.location}`,
      );
      groupCheckbox.addEventListener("change", () => {
        group.mappings.forEach((mapping) => {
          if (groupCheckbox.checked) state.selectedMappings.add(mapping.key);
          else state.selectedMappings.delete(mapping.key);
        });
        renderMappingTable();
        updateRemovalButtons();
      });
      groupSelection.append(groupCheckbox);
      const location = document.createElement("th");
      location.scope = "rowgroup";
      location.colSpan = 5;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mapping-location-toggle";
      toggle.setAttribute("aria-expanded", String(expanded));
      const locationName = document.createElement("span");
      locationName.textContent = group.location;
      const count = document.createElement("span");
      count.className = "mapping-location-count";
      count.textContent = `${group.mappings.length} site${group.mappings.length === 1 ? "" : "s"}`;
      const rowIds = group.mappings.map((_, index) => `mapping-group-${groupIndex}-site-${index}`);
      toggle.setAttribute("aria-controls", rowIds.join(" "));
      toggle.append(locationName, count);
      toggle.addEventListener("click", () => {
        if (expanded) state.expandedMappingLocations.delete(groupKey);
        else state.expandedMappingLocations.add(groupKey);
        renderMappingTable();
      });
      location.append(toggle);
      locationRow.append(groupSelection, location);
      elements["mapping-table-body"].append(locationRow);

      group.mappings.forEach((mapping, mappingIndex) => {
        const row = document.createElement("tr");
        row.className = "mapping-site-row";
        row.id = rowIds[mappingIndex];
        row.hidden = !expanded;
        const selection = document.createElement("td");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.selectedMappings.has(mapping.key);
        checkbox.setAttribute("aria-label", `Select ${mapping.location} / ${mapping.site}`);
        checkbox.addEventListener("change", () => {
          checkbox.checked
            ? state.selectedMappings.add(mapping.key)
            : state.selectedMappings.delete(mapping.key);
          renderMappingTable();
          updateRemovalButtons();
        });
        selection.append(checkbox);
        row.append(selection);
        const site = document.createElement("th");
        site.scope = "row";
        site.textContent = mapping.site;
        row.append(site);
        cell(row, mapping.country || UNASSIGNED_COUNTRY);
        cell(row, mapping.latitude.toFixed(5));
        cell(row, mapping.longitude.toFixed(5));
        cell(row, mapping.confidence);
        elements["mapping-table-body"].append(row);
      });
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

function dateRangeFilters() {
  if (state.dateValues.length < 2) return { from: "", to: "" };
  const start = Number(elements["date-range-start"].value);
  const end = Number(elements["date-range-end"].value);
  const max = state.dateValues.length - 1;
  return {
    from: start > 0 ? state.dateValues[start] : "",
    to: end < max ? state.dateValues[end] : "",
  };
}

function currentViewDives() {
  const dates = dateRangeFilters();
  return filterDives(state.dives, {
    ...dates,
    search: elements["view-search"].value,
    minDepth: elements["min-depth"].value,
    minDuration: elements["min-duration"].value,
  });
}

function selectedDateExtent() {
  if (!state.dateValues.length) return { from: "", to: "" };
  return {
    from: state.dateValues[Number(elements["date-range-start"].value)] ?? "",
    to: state.dateValues[Number(elements["date-range-end"].value)] ?? "",
  };
}

function renderSelectionStats() {
  const dives = state.dives.filter((dive) => state.selectedViewDives.has(dive.id));
  setSelectionPaneEmpty(dives.length === 0);
  if (!state.dives.length) {
    elements["selection-stats"].replaceChildren();
    return;
  }
  renderSelectionStatistics(elements["selection-stats"], dives, {
    ...selectedDateExtent(),
    libraryDives: state.dives,
    onSelectDives: (selectedDives, { fitMap = true } = {}) => {
      void selectViewDives(selectedDives.map((dive) => dive.id), {
        fitMap,
        updateMap: true,
      });
    },
  });
}

function setSelectionPaneEmpty(empty) {
  elements["selection-empty"].hidden = !empty;
  ["profile-chart", "dive-detail"].forEach((id) => {
    elements[id].hidden = empty;
  });
  elements["selection-stats"].hidden = state.dives.length === 0;
}

async function renderSelectedDiveDetails() {
  const renderVersion = ++state.profileRenderVersion;
  const dives = state.dives.filter((dive) => state.selectedViewDives.has(dive.id));
  if (!dives.length) {
    setSelectionPaneEmpty(true);
    elements["dive-detail"].replaceChildren();
    elements["profile-chart"].replaceChildren();
    return;
  }
  setSelectionPaneEmpty(false);
  const locationSummary = dives.length === 1 ? document.createElement("p") : null;
  if (locationSummary) {
    locationSummary.textContent = `${dives[0].site}, ${dives[0].location}`;
  }
  const selectionSummary = document.createElement("p");
  selectionSummary.className = "selection-count-summary";
  const selectedCount = document.createElement("span");
  selectedCount.className = "selection-count selection-count-series";
  const selectedKey = document.createElement("span");
  selectedKey.className = "selection-count-key";
  selectedKey.setAttribute("aria-hidden", "true");
  selectedCount.append(
    document.createTextNode(
      `${dives.length} dive${dives.length === 1 ? "" : "s"} selected`,
    ),
    selectedKey,
  );
  const libraryCount = document.createElement("span");
  libraryCount.className = "library-count selection-count-series";
  const libraryKey = document.createElement("span");
  libraryKey.className = "selection-count-key";
  libraryKey.setAttribute("aria-hidden", "true");
  libraryCount.append(
    document.createTextNode(
      `out of ${state.dives.length}`,
    ),
    libraryKey,
  );
  selectionSummary.append(
    selectedCount,
    document.createTextNode(" "),
    libraryCount,
  );
  const detailsElement = dives.length === 1 ? document.createElement("dl") : null;
  if (dives.length === 1) {
    const dive = dives[0];
    const details = [
      ["Dive", dive.number ?? "—"],
      ["Date", dive.dateTime ? new Date(dive.dateTime).toLocaleString() : "Unknown"],
      ["Maximum depth", Number.isFinite(dive.maxDepth) ? `${dive.maxDepth.toFixed(1)} m` : "—"],
      ["Duration", Number.isFinite(dive.durationSeconds) ? `${Math.round(dive.durationSeconds / 60)} min` : "—"],
      [
        "Dive type",
        dive.decoDive === true
          ? "Decompression"
          : dive.decoDive === false
            ? "No-decompression"
            : "Unknown",
      ],
      ["Computer", [dive.computer.manufacturer, dive.computer.model].filter(Boolean).join(" ") || "Unknown"],
      ["Decompression", dive.decompression.model || "Unknown"],
      ["Gradient factors", Number.isFinite(dive.decompression.gfLow) ? `${dive.decompression.gfLow}/${dive.decompression.gfHigh}` : "—"],
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
  }
  elements["dive-detail"].replaceChildren(
    ...[locationSummary, selectionSummary, detailsElement].filter(Boolean),
  );
  const profiles = await Promise.all(
    dives.map(async (dive) => ({
      label: `Dive ${dive.number ?? "—"} · ${dive.site}`,
      number: dive.number,
      location: dive.location,
      site: dive.site,
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

async function selectViewDives(
  ids,
  { fitMap = false, updateMap = fitMap } = {},
) {
  state.selectedViewDives = new Set(ids);
  if (fitMap) state.mapBounds = null;
  renderView({
    updateMap,
    fitMap,
    mapFitDiveIds: updateMap ? state.selectedViewDives : null,
  });
  await renderSelectedDiveDetails();
}

function currentMapDives() {
  const lookup = mappingLookup();
  const mappedDives = currentViewDives().filter((dive) => lookup.has(dive.mappingKey));
  return filterDivesToBounds(mappedDives, lookup, state.mapBounds);
}

function currentListDives() {
  const baseDives = currentViewDives();
  return state.showOutsideMap
    ? baseDives
    : filterDivesToBounds(baseDives, mappingLookup(), state.mapBounds);
}

async function handleMapBoundsChange(bounds) {
  state.mapBounds = bounds;
  const mapDives = currentMapDives();
  const autoSelect = state.selectedViewDives.size === 0 && mapDives.length > 0 && mapDives.length <= 5;
  if (autoSelect) {
    state.selectedViewDives = new Set(mapDives.map((dive) => dive.id));
  }
  renderView({ updateMap: false });
  if (autoSelect) await renderSelectedDiveDetails();
}

function renderView({ updateMap = true, fitMap = false, mapFitDiveIds = null } = {}) {
  const baseDives = currentViewDives();
  const lookup = mappingLookup();
  const divesInMap = filterDivesToBounds(baseDives, lookup, state.mapBounds);
  const showOutside = state.showOutsideMap;
  const dives = showOutside ? baseDives : divesInMap;
  const divesInMapIds = new Set(divesInMap.map((dive) => dive.id));
  const outsideCount = baseDives.length - divesInMap.length;
  elements["view-result-count"].textContent = state.mapBounds
    ? `${divesInMap.length} of ${baseDives.length} dives in map view${
        showOutside ? " · showing all" : ""
      }`
    : outsideCount
      ? `${divesInMap.length} of ${baseDives.length} mapped dives${
          showOutside ? " · showing all" : ""
        }`
      : `${dives.length} dive${dives.length === 1 ? "" : "s"}`;
  elements["show-outside-map"].disabled = outsideCount === 0;
  elements["show-outside-map"].checked = showOutside;
  const mapDiveCount = currentMapDives().length;
  elements["select-map-dives"].disabled = mapDiveCount === 0;
  elements["select-map-dives"].textContent = `Select ${mapDiveCount} dive${
    mapDiveCount === 1 ? "" : "s"
  } in map`;
  elements["select-list-dives"].disabled = dives.length === 0;
  elements["clear-view-dives"].disabled = state.selectedViewDives.size === 0;
  renderSelectionStats();
  elements["view-dive-list"].replaceChildren();
  const diveRows = dives.map((dive) => ({
    ...dive,
    country: lookup.get(dive.mappingKey)?.country ?? "Unmapped",
  }));
  sortDives(diveRows, state.sortField, state.sortDirection).forEach((dive) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dive-row";
    button.classList.toggle("is-outside-map", showOutside && !divesInMapIds.has(dive.id));
    const selected = state.selectedViewDives.has(dive.id);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected);
    button.setAttribute(
      "aria-label",
      `Dive ${dive.number ?? "unknown"}, ${dive.location}, ${dive.site}`,
    );
    const values = [
      ["dive-cell dive-number", dive.number ?? "—"],
      ["dive-cell", dive.site],
      ["dive-cell", dive.location],
      ["dive-cell dive-country", dive.country],
    ];
    values.forEach(([className, value]) => {
      const item = document.createElement("span");
      item.className = className;
      item.textContent = value;
      item.title = String(value);
      button.append(item);
    });
    const stats = document.createElement("span");
    stats.className = "dive-stats";
    const depth = Number.isFinite(dive.maxDepth) ? `${dive.maxDepth.toFixed(1)} m` : "—";
    const duration = Number.isFinite(dive.durationSeconds)
      ? `${Math.round(dive.durationSeconds / 60)} min`
      : "—";
    stats.textContent = `${
      dive.dateTime?.slice(0, 10) || "Unknown date"
    } · ${depth} · ${duration}`;
    button.append(stats);
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
  if (updateMap) {
    renderMap([...groups.values()], {
      fit: fitMap,
      fitDiveIds: mapFitDiveIds,
      selectedDiveIds: state.selectedViewDives,
    });
  } else {
    updateMapSelection(state.selectedViewDives);
  }
  document.querySelectorAll("[data-sort]").forEach((button) => {
    const active = button.dataset.sort === state.sortField;
    button.textContent = `${button.dataset.label}${active ? (state.sortDirection === "asc" ? " ↑" : " ↓") : ""}`;
    if (active) button.dataset.direction = state.sortDirection;
    else delete button.dataset.direction;
  });
}

function configureDateRange() {
  state.dateValues = [
    ...new Set(state.dives.map((dive) => dive.dateTime?.slice(0, 10)).filter(Boolean)),
  ].sort();
  const max = Math.max(0, state.dateValues.length - 1);
  ["date-range-start", "date-range-end"].forEach((id) => {
    elements[id].max = max;
    elements[id].disabled = state.dateValues.length < 2;
  });
  elements["date-range-start"].value = 0;
  elements["date-range-end"].value = max;
  updateDateRangeLabel();
}

function updateDateRangeLabel() {
  if (!state.dateValues.length) {
    elements["date-range-label"].value = "No dated dives";
    return;
  }
  const start = state.dateValues[Number(elements["date-range-start"].value)];
  const end = state.dateValues[Number(elements["date-range-end"].value)];
  elements["date-range-label"].value = start === end ? start : `${start} – ${end}`;
  const max = state.dateValues.length - 1;
  const startPercent = max > 0 ? (Number(elements["date-range-start"].value) / max) * 100 : 0;
  const endPercent = max > 0 ? (Number(elements["date-range-end"].value) / max) * 100 : 100;
  elements["date-range-track"].style.setProperty("--range-start", `${startPercent}%`);
  elements["date-range-track"].style.setProperty("--range-end", `${endPercent}%`);
}

function updateRemovalButtons() {
  elements["remove-dives"].disabled = state.selectedDives.size === 0;
  elements["remove-mappings"].disabled = state.selectedMappings.size === 0;
}

function updateClearAllDataButton() {
  elements["clear-all-data"].disabled = state.diveImporting || state.coordinateImporting;
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
  const [dives, mappings] = await Promise.all([getAll("dives"), getAll("mappings")]);
  const enrichedMappings = mappings.map(enrichMappingCountry);
  const missingCountries = enrichedMappings.filter((mapping, index) => !mappings[index].country);
  if (missingCountries.length) await applyMappings(missingCountries, "merge");
  state.dives = dives;
  state.mappings = enrichedMappings;
  state.dives.sort((a, b) => (b.dateTime || "").localeCompare(a.dateTime || ""));
  state.mappings.sort((a, b) =>
    `${a.location}\u001f${a.site}`.localeCompare(`${b.location}\u001f${b.site}`),
  );
  const diveIds = new Set(state.dives.map((dive) => dive.id));
  state.selectedViewDives = new Set(
    [...state.selectedViewDives].filter((id) => diveIds.has(id)),
  );
  state.mapBounds = null;
  configureDateRange();
  renderSummary();
  renderDiveTable();
  renderMappingTable();
  renderView({ fitMap: state.mapInitialized });
  await renderSelectedDiveDetails();
  updateRemovalButtons();
  await updateStorageStatus();
}

function registerEvents() {
  const updateThemeButtons = (preference) => {
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preference));
    });
  };
  updateThemeButtons(globalThis.diveAtlasTheme?.preference ?? "system");
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      globalThis.diveAtlasTheme?.set(button.dataset.themeChoice);
      updateThemeButtons(button.dataset.themeChoice);
      setAppMenuOpen(false, { focusButton: true });
    });
  });
  document.querySelectorAll("[data-workspace]").forEach((button) => {
    button.addEventListener("click", () => {
      setWorkspace(button.dataset.workspace);
      setAppMenuOpen(false, { focusButton: true });
    });
  });
  elements["app-menu-button"].addEventListener("click", () => {
    setAppMenuOpen(elements["app-menu-panel"].hidden);
  });
  document.addEventListener("click", (event) => {
    if (
      elements["app-menu-panel"].hidden ||
      event.target.closest(".app-menu")
    ) {
      return;
    }
    setAppMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || elements["app-menu-panel"].hidden) return;
    setAppMenuOpen(false, { focusButton: true });
  });
  ["close-welcome", "accept-welcome"].forEach((id) => {
    elements[id].addEventListener("click", () => elements["welcome-dialog"].close());
  });
  elements["welcome-dialog"].addEventListener("click", (event) => {
    if (event.target === elements["welcome-dialog"]) elements["welcome-dialog"].close();
  });
  elements["open-welcome-screenshot"].addEventListener("click", () => {
    elements["welcome-screenshot-dialog"].showModal();
  });
  elements["close-welcome-screenshot"].addEventListener("click", () => {
    elements["welcome-screenshot-dialog"].close();
  });
  elements["welcome-screenshot-dialog"].addEventListener("click", (event) => {
    if (event.target === elements["welcome-screenshot-dialog"]) {
      elements["welcome-screenshot-dialog"].close();
    }
  });
  elements["dive-files"].addEventListener("change", (event) => {
    setDiveFiles(event.target.files);
    event.target.value = "";
    if (state.pendingDiveFiles.length) void handleDiveImport();
  });
  elements["coordinate-file"].addEventListener("change", (event) => {
    setCoordinateFiles(event.target.files);
    event.target.value = "";
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
  elements["clear-all-data"].addEventListener("click", async () => {
    if (
      !confirm(
        "Clear all DiveAtlas dives, profiles, coordinate mappings, import history, and settings from this browser?",
      )
    ) {
      return;
    }
    await clearLibrary();
    state.selectedDives.clear();
    state.selectedMappings.clear();
    state.selectedViewDives.clear();
    await refreshLibrary();
    setWorkspace("data");
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
  ["view-search", "min-depth", "min-duration"].forEach((id) =>
    elements[id].addEventListener("input", () => renderView()),
  );
  const updateDateFilter = (changed) => {
    let start = Number(elements["date-range-start"].value);
    let end = Number(elements["date-range-end"].value);
    if (start > end) {
      if (changed === "date-range-start") end = start;
      else start = end;
      elements["date-range-start"].value = start;
      elements["date-range-end"].value = end;
    }
    updateDateRangeLabel();
    renderView();
  };
  ["date-range-start", "date-range-end"].forEach((id) =>
    elements[id].addEventListener("input", () => updateDateFilter(id)),
  );
  document.querySelectorAll("[data-sort]").forEach((button) =>
    button.addEventListener("click", () => {
      const field = button.dataset.sort;
      if (state.sortField === field) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortField = field;
        state.sortDirection = field === "number" ? "desc" : "asc";
      }
      renderView({ updateMap: false });
    }),
  );
  elements["clear-filters"].addEventListener("click", () => {
    elements["view-search"].value = "";
    elements["min-depth"].value = "0";
    elements["min-duration"].value = "0";
    elements["date-range-start"].value = 0;
    elements["date-range-end"].value = Math.max(0, state.dateValues.length - 1);
    updateDateRangeLabel();
    state.mapBounds = null;
    state.showOutsideMap = false;
    renderView({ fitMap: true });
  });
  elements["show-outside-map"].addEventListener("change", (event) => {
    state.showOutsideMap = event.currentTarget.checked;
    renderView({ updateMap: false });
  });
  elements["select-map-dives"].addEventListener("click", async () => {
    const ids = currentMapDives().map((dive) => dive.id);
    state.selectedViewDives = new Set(ids);
    renderView({ updateMap: false });
    await renderSelectedDiveDetails();
  });
  elements["select-list-dives"].addEventListener("click", async () => {
    const ids = currentListDives().map((dive) => dive.id);
    state.selectedViewDives = new Set(ids);
    renderView({ updateMap: false });
    await renderSelectedDiveDetails();
  });
  elements["clear-view-dives"].addEventListener("click", async () => {
    state.selectedViewDives.clear();
    renderView({ updateMap: false });
    await renderSelectedDiveDetails();
  });
}

async function start() {
  await openDatabase();
  registerEvents();
  await refreshLibrary();
  setWorkspace(state.dives.length ? "view" : "data");
  if (!state.dives.length) elements["welcome-dialog"].showModal();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(new URL("../sw.js", import.meta.url));
  }
}

start().catch((error) => {
  setWorkspace("data");
  elements["dive-import-results"].textContent = `DiveAtlas could not start: ${error.message}`;
});
