# DiveAtlas privacy notice

DiveAtlas is a static, browser-only application. It has no account system, analytics, advertising, cookies, upload endpoint, or remote dive-data service. UDDF files, coordinate CSV files, normalized dives, profile samples, and DiveAtlas backups are processed on the device and stored in that browser's IndexedDB database. The application never transmits those records.

## Local storage

The library is tied to the browser profile and origin where it was imported. Reloading the app restores it from IndexedDB. Clearing site data, using private-browsing storage, removing the browser profile, or losing the device can remove the library. Persistent-storage permission can reduce automatic eviction risk but is not a backup. Keep the original UDDF exports as the source-of-truth archive and download DiveAtlas backups regularly.

## Network connections

The application shell is hosted by GitHub Pages. GitHub may receive and log normal web-request information, including IP address and user agent, under [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

When the View workspace loads the interactive map, the configured OpenStreetMap tile service receives requests for map tiles plus normal network information such as the visitor's IP address. Tile coordinates can reveal the geographic area being viewed. The tile requests do not include dive records, profile samples, imported file contents, or backup data. OpenStreetMap's services are governed by the [OSMF privacy policy](https://osmfoundation.org/wiki/Privacy_Policy).

No other third-party runtime service is configured. The locally vendored Leaflet library renders the map, and the Content Security Policy limits outbound application connections to the configured tile host.

## Backups

A downloaded backup contains normalized dive data, profile samples, coordinate mappings, and import history. Treat it as personal data and store it securely. Original UDDF files remain the authoritative archive.

## Questions

Privacy behavior is implemented openly in this repository. Review or report concerns through the repository's GitHub issue tracker without attaching personal dive files.
