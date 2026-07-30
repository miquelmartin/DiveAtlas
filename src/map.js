import { TILE_CONFIG } from "./config.js";

let map;
let markerLayer;
let markersByDiveId = new Map();
let onBoundsChange = () => {};
let onMarkerSelect = () => {};
let programmaticMove = false;

function diveIcon(selected) {
  return L.divIcon({
    className: `dive-map-marker${selected ? " is-selected" : ""}`,
    html: "<span></span>",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function clusterIcon(cluster) {
  const markers = cluster.getAllChildMarkers();
  const selectedCount = markers.filter((marker) => marker.options.diveSelected).length;
  const size =
    markers.length < 10 ? "small" : markers.length < 100 ? "medium" : "large";
  return L.divIcon({
    html: `<div><span>${markers.length}</span></div>`,
    className: `marker-cluster marker-cluster-${size}${
      selectedCount ? " has-selected-dives" : ""
    }${selectedCount === markers.length ? " all-selected-dives" : ""}`,
    iconSize: L.point(40, 40),
  });
}

export function initializeMap(element, callbacks = {}) {
  if (!globalThis.L) {
    element.textContent = "Map library unavailable. Dive data remains available in the list.";
    return;
  }
  onBoundsChange = callbacks.onBoundsChange ?? onBoundsChange;
  onMarkerSelect = callbacks.onMarkerSelect ?? onMarkerSelect;
  map = L.map(element, { zoomControl: true }).setView([20, 0], 2);
  const satellite = L.tileLayer(TILE_CONFIG.satellite.url, TILE_CONFIG.satellite).addTo(map);
  const street = L.tileLayer(TILE_CONFIG.street.url, TILE_CONFIG.street);
  const seamarks = L.tileLayer(TILE_CONFIG.seamarks.url, TILE_CONFIG.seamarks);
  L.control
    .layers(
      {
        [TILE_CONFIG.satellite.label]: satellite,
        [TILE_CONFIG.street.label]: street,
      },
      { [TILE_CONFIG.seamarks.label]: seamarks },
      { position: "topright" },
    )
    .addTo(map);
  markerLayer = (
    L.markerClusterGroup
      ? L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 28,
          disableClusteringAtZoom: 11,
          spiderfyOnMaxZoom: true,
          iconCreateFunction: clusterIcon,
        })
      : L.layerGroup()
  ).addTo(map);
  map.on("moveend", () => {
    if (programmaticMove) return;
    const bounds = map.getBounds();
    onBoundsChange({
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
    });
  });
}

export function renderMap(diveGroups, { fit = false, selectedDiveIds = new Set() } = {}) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  markersByDiveId = new Map();
  const bounds = [];
  diveGroups.forEach(({ mapping, dives }) => {
    const coordinates = [mapping.latitude, mapping.longitude];
    dives.forEach((dive) => {
      bounds.push(coordinates);
      const selected = selectedDiveIds.has(dive.id);
      const marker = L.marker(coordinates, {
        icon: diveIcon(selected),
        diveSelected: selected,
        diveLabel: dive.number ?? "unknown",
        title: `Dive ${dive.number ?? "unknown"}${selected ? ", selected" : ""}`,
      }).bindPopup(
        `<strong>Dive ${escapeHtml(dive.number ?? "—")}</strong><br>${escapeHtml(
          mapping.site,
        )}<br>${escapeHtml(mapping.location)}`,
        { autoPan: false },
      );
      marker.on("click", () => onMarkerSelect([dive.id]));
      marker.on("add", () => {
        marker.getElement()?.setAttribute("aria-pressed", String(marker.options.diveSelected));
      });
      markersByDiveId.set(dive.id, marker);
      markerLayer.addLayer(marker);
    });
  });
  if (fit && bounds.length) {
    programmaticMove = true;
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 11, animate: false });
    programmaticMove = false;
  }
}

export function updateMapSelection(selectedDiveIds) {
  if (!markerLayer) return;
  markersByDiveId.forEach((marker, diveId) => {
    const selected = selectedDiveIds.has(diveId);
    if (marker.options.diveSelected === selected) return;
    marker.options.diveSelected = selected;
    marker.options.title = `Dive ${marker.options.diveLabel}${selected ? ", selected" : ""}`;
    marker.setIcon(diveIcon(selected));
    marker.getElement()?.setAttribute("aria-pressed", String(selected));
  });
  markerLayer.refreshClusters?.();
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
