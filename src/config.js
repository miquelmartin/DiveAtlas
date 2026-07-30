export const APP_VERSION = "1.1.0";
export const DB_NAME = "diveatlas";
export const DB_VERSION = 5;
export const DIVE_IMPORT_VERSION = 3;
export const BACKUP_FORMAT = "diveatlas-backup";
export const BACKUP_VERSION = 1;

export const TILE_CONFIG = Object.freeze({
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
  street: {
    label: "Street map",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  seamarks: {
    label: "Seamarks",
    url: "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
    attribution:
      'Seamarks &copy; <a href="https://www.openseamap.org/">OpenSeaMap</a> contributors',
    maxZoom: 18,
  },
});
