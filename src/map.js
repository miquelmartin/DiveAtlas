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

export function renderMap(diveGroups, { fit = false } = {}) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  const bounds = [];
  const diveIcon = L.divIcon({
    className: "dive-map-marker",
    html: "<span></span>",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  diveGroups.forEach(({ mapping, dives }) => {
    const coordinates = [mapping.latitude, mapping.longitude];
    dives.forEach((dive) => {
      bounds.push(coordinates);
      const marker = L.marker(coordinates, { icon: diveIcon }).bindPopup(
        `<strong>Dive ${escapeHtml(dive.number ?? "—")}</strong><br>${escapeHtml(
          mapping.site,
        )}<br>${escapeHtml(mapping.location)}`,
        { autoPan: false },
      );
      marker.on("click", () => onMarkerSelect([dive.id]));
      markerLayer.addLayer(marker);
    });
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
