import { TILE_CONFIG } from "./config.js";

let map;
let markerLayer;
let onBoundsChange = () => {};
let onMarkerSelect = () => {};
let programmaticMove = false;

export function initializeMap(element, callbacks = {}) {
  if (!globalThis.L) {
    element.textContent = "Map library unavailable. Dive data remains available in the list.";
    return;
  }
  onBoundsChange = callbacks.onBoundsChange ?? onBoundsChange;
  onMarkerSelect = callbacks.onMarkerSelect ?? onMarkerSelect;
  map = L.map(element).setView([20, 0], 2);
  L.tileLayer(TILE_CONFIG.url, {
    attribution: TILE_CONFIG.attribution,
    maxZoom: TILE_CONFIG.maxZoom,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
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

export function renderMap(diveGroups, { fit = false } = {}) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  const bounds = [];
  diveGroups.forEach(({ mapping, dives }) => {
    const coordinates = [mapping.latitude, mapping.longitude];
    bounds.push(coordinates);
    const marker = L.marker(coordinates)
      .bindPopup(
        `<strong>${escapeHtml(mapping.site)}</strong><br>${escapeHtml(mapping.location)}<br>${
          dives.length
        } dive${dives.length === 1 ? "" : "s"}`,
        { autoPan: false },
      )
      .addTo(markerLayer);
    marker.on("click", () => onMarkerSelect(dives.map((dive) => dive.id)));
  });
  if (fit && bounds.length) {
    programmaticMove = true;
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 11, animate: false });
    programmaticMove = false;
  }
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
