export const APP_VERSION = "1.0.0";
export const DB_NAME = "diveatlas";
export const DB_VERSION = 1;
export const BACKUP_FORMAT = "diveatlas-backup";
export const BACKUP_VERSION = 1;

export const TILE_CONFIG = Object.freeze({
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
});
