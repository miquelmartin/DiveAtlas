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

function markerDetails(dive, mapping) {
  const date = dive.dateTime?.slice(0, 10) || "Unknown date";
  const depth = Number.isFinite(dive.maxDepth) ? `${dive.maxDepth.toFixed(1)} m` : "Unknown";
  const duration = Number.isFinite(dive.durationSeconds)
    ? `${Math.round(dive.durationSeconds / 60)} min`
    : "Unknown";
  return `
    <strong>Dive ${escapeHtml(dive.number ?? "—")}</strong>
    <dl class="map-dive-summary">
      <div><dt>Date</dt><dd>${escapeHtml(date)}</dd></div>
      <div><dt>Location</dt><dd>${escapeHtml(mapping.location)}</dd></div>
      <div><dt>Site</dt><dd>${escapeHtml(mapping.site)}</dd></div>
      <div><dt>Maximum depth</dt><dd>${escapeHtml(depth)}</dd></div>
      <div><dt>Duration</dt><dd>${escapeHtml(duration)}</dd></div>
    </dl>`;
}

function updateMapAccessibleLabel() {
  if (!map) return;
  const selectedCount = [...markersByDiveId.values()].filter(
    (marker) => marker.options.diveSelected,
  ).length;
  map
    .getContainer()
    .setAttribute(
      "aria-label",
      `Interactive map of ${markersByDiveId.size} mapped dives; ${selectedCount} selected`,
    );
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
          spiderfyDistanceMultiplier: 1.4,
          spiderLegPolylineOptions: {
            className: "dive-spider-leg",
            opacity: 1,
            weight: 3,
          },
          spiderfyOnMaxZoom: false,
          zoomToBoundsOnClick: false,
          iconCreateFunction: clusterIcon,
        })
      : L.layerGroup()
  ).addTo(map);
  const expandCluster = ({ layer: cluster }) => {
    const markers = cluster.getAllChildMarkers();
    const origin = markers[0]?.getLatLng();
    const sharesCoordinates =
      markers.length > 1 && markers.every((marker) => marker.getLatLng().equals(origin));
    if (sharesCoordinates || map.getZoom() === map.getMaxZoom()) {
      cluster.spiderfy();
    } else {
      cluster.zoomToBounds();
    }
  };
  markerLayer.on?.("clusterclick clusterkeypress", expandCluster);
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

export function renderMap(
  diveGroups,
  { fit = false, fitDiveIds = null, selectedDiveIds = new Set() } = {},
) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  markersByDiveId = new Map();
  const bounds = [];
  diveGroups.forEach(({ mapping, dives }) => {
    const coordinates = [mapping.latitude, mapping.longitude];
    dives.forEach((dive) => {
      if (!fitDiveIds || fitDiveIds.has(dive.id)) bounds.push(coordinates);
      const selected = selectedDiveIds.has(dive.id);
      const marker = L.marker(coordinates, {
        icon: diveIcon(selected),
        diveSelected: selected,
        diveLabel: dive.number ?? "unknown",
      });
      const details = markerDetails(dive, mapping);
      marker.bindTooltip(details, {
        className: "map-dive-tooltip",
        direction: "top",
        offset: [0, -8],
      });
      marker.on("click", () => {
        marker.openTooltip();
        onMarkerSelect([dive.id]);
      });
      marker.on("add", () => {
        const element = marker.getElement();
        element?.setAttribute("aria-pressed", String(marker.options.diveSelected));
        element?.setAttribute("aria-label", `Dive ${marker.options.diveLabel}`);
      });
      markersByDiveId.set(dive.id, marker);
      markerLayer.addLayer(marker);
    });
  });
  updateMapAccessibleLabel();
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
    marker.setIcon(diveIcon(selected));
    const element = marker.getElement();
    element?.setAttribute("aria-pressed", String(selected));
    element?.setAttribute("aria-label", `Dive ${marker.options.diveLabel}`);
  });
  markerLayer.refreshClusters?.();
  updateMapAccessibleLabel();
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
