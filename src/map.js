import { TILE_CONFIG } from "./config.js";

let map;
let markerLayer;

export function initializeMap(element) {
  if (!globalThis.L) {
    element.textContent = "Map library unavailable. Dive data remains available in the list.";
    return;
  }
  map = L.map(element).setView([20, 0], 2);
  L.tileLayer(TILE_CONFIG.url, {
    attribution: TILE_CONFIG.attribution,
    maxZoom: TILE_CONFIG.maxZoom,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

export function renderMap(diveGroups) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  const bounds = [];
  diveGroups.forEach(({ mapping, dives }) => {
    const coordinates = [mapping.latitude, mapping.longitude];
    bounds.push(coordinates);
    L.marker(coordinates)
      .bindPopup(
        `<strong>${escapeHtml(mapping.site)}</strong><br>${escapeHtml(mapping.location)}<br>${
          dives.length
        } dive${dives.length === 1 ? "" : "s"}`,
      )
      .addTo(markerLayer);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 11 });
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
