# DiveAtlas privacy notice

DiveAtlas is a static, browser-only application. It has no account system, analytics, advertising, cookies, upload endpoint, or remote dive-data service. UDDF files, coordinate CSV files, normalized dives, profile samples, and DiveAtlas backups are processed on the device and stored in that browser's IndexedDB database. The application never transmits those records.

## Local storage

The library is tied to the browser profile and origin where it was imported. Reloading the app restores it from IndexedDB. A light/dark theme override, when selected, is stored locally in `localStorage`; System mode stores no override. Clearing site data, using private-browsing storage, removing the browser profile, or losing the device can remove the library and preference. Persistent-storage permission can reduce automatic eviction risk but is not a backup. Keep the original UDDF exports as the source-of-truth archive and download DiveAtlas backups regularly.

## Network connections

The application shell is hosted by GitHub Pages. GitHub may receive and log normal web-request information, including IP address and user agent, under [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

The map defaults to Esri World Imagery. Esri receives requests for satellite tiles plus normal network information such as the visitor's IP address, and tile coordinates can reveal the geographic area being viewed. Esri's services are governed by the [Esri Products & Services Privacy Statement](https://www.esri.com/en-us/privacy/privacy-statements/privacy-statement).

The layer control can instead display OpenStreetMap streets and can add OpenSeaMap seamarks. A provider receives requests only while its layer is displayed. OpenStreetMap's services are governed by the [OSMF privacy policy](https://osmfoundation.org/wiki/Privacy_Policy), and OpenSeaMap publishes its [privacy policy](https://www.openseamap.org/index.php?id=privacy&L=1). These tile requests never include dive records, profile samples, imported file contents, coordinate rows, country-inference results, or backup data.

Leaflet, Leaflet.markercluster, and the country-boundary coder are served with DiveAtlas. Country inference runs locally and makes no geocoding request. The Content Security Policy limits outbound application connections to the three configured tile hosts.

## Backups

A downloaded backup contains normalized dive data, profile samples, coordinate mappings, and import history. Treat it as personal data and store it securely. Original UDDF files remain the authoritative archive.

## Questions

Privacy behavior is implemented openly in this repository. Review or report concerns through the repository's GitHub issue tracker without attaching personal dive files.
