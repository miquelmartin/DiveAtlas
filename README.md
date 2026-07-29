# DiveAtlas

DiveAtlas is a static, privacy-focused dive log for Shearwater-style UDDF 3.2 exports. It imports hundreds of dive files and a Location/Site coordinate table, persists a normalized library in IndexedDB, maps matched sites, and renders interactive depth profiles without uploading dive data.

## Features

- Incremental, cancellable multi-file import with SHA-256 source hashing and worker-assisted file processing
- Stable dive identities, exact duplicate skipping, and conflict reporting without silent overwrite
- Searchable, selectable dive and coordinate tables with atomic dependent-data removal
- Case-insensitive Location/Site matching, actionable unmatched-site reporting, and merge/replace coordinate controls
- Interactive Leaflet map, location/site/date/text filters, dive details, and a native SVG depth profile
- Versioned JSON backup with validated merge or transactional replace restore
- Local storage usage and persistence status, installable shell, offline application assets, and GitHub Pages deployment

## Run locally

The application uses browser modules and service workers, so serve it over HTTP rather than opening `index.html` directly:

```sh
npx serve .
```

Then open the printed local URL. No build step is required. To run the release checks:

```sh
npm ci
npm run check
```

Node.js 22 is used in CI. Current Chromium, Firefox, and Safari releases with IndexedDB, Web Crypto, Web Workers, DOMParser, SVG, and ES module support are targeted. Persistent-storage behavior and install prompts vary by browser.

## Import workflow

1. Open **Data** and choose any mixture of `.uddf`, `.xml`, and `.csv` files in one picker operation. Drag/drop is also supported.
2. Choose whether coordinate rows merge into the stored table or replace it.
3. Start the import. Files are read one at a time, the page yields between files, and cancellation stops before the next file.
4. Review every file result and any duplicate, invalid, or conflict details. A bad file does not block valid files.
5. Inspect unmatched sites, then use **View** to filter the library, map matched sites, and inspect profiles.

Exact source reimports are skipped by SHA-256. All dives from one UDDF source are written atomically, and deleting any constituent dive invalidates that source's completion marker so it can be reimported. A different source containing the same normalized dive is skipped when content is identical. Changed content with the same stable identity is retained as a conflict for review; DiveAtlas never silently overwrites the stored dive.

## Coordinate CSV contract

The header row must contain:

| Header | Requirement |
| --- | --- |
| `Location` | Required, non-empty display text |
| `Site` | Required, non-empty display text |
| `Latitude` | Required number from -90 through 90 |
| `Longitude` | Required number from -180 through 180 |
| `Confidence` | Optional; blank or absent defaults to `Exact` |

Additional columns are accepted and ignored. Header and field whitespace is trimmed. Matching uses trimmed, whitespace-normalized, case-insensitive `Location + Site` keys while preserving the first row's display text. Duplicate keys are reported. Conflicting coordinates are reported and never silently overwrite the first or stored row.

```csv
Location,Site,Latitude,Longitude,Confidence,Notes
"Example Island, Test Region",Blue Wall,28.12345,-17.54321,Surveyed,Optional note
"Example Island, Test Region",Second Site,28.10000,-17.50000,,Defaults to Exact
```

## Local storage and backups

Dives, profile samples, coordinate mappings, import history, and settings use a versioned IndexedDB schema. Profile samples live in a separate store so browsing and filtering hundreds of dives does not load every sample into memory. A dive deletion removes metadata, profile samples, and dependent import history in one transaction.

Reloading the same origin and browser profile restores the library. Clearing browser site data removes it. Private browsing may be temporary, and storage eviction policy is browser-specific. Use **Request persistent storage** where supported.

Download versioned DiveAtlas backups regularly. Restore supports:

- **Merge:** add missing dives and mappings, report conflicts, retain stored records.
- **Replace:** validate first, then replace all stores transactionally.

Restoring a backup into empty storage reproduces normalized dives, profiles, mappings, and import history. Keep original UDDF files separately as the source-of-truth archive.

## Privacy and offline behavior

DiveAtlas has no analytics, cookies, accounts, backend, upload endpoint, or remote persistence. Imported files, normalized records, and backups are not transmitted. See [PRIVACY.md](PRIVACY.md) for the complete disclosure.

GitHub Pages may log ordinary request information including IP addresses. Opening the map requests tiles from OpenStreetMap; the provider receives the request and IP address and can infer the viewed map area. No dive records are included in tile requests. The tile provider is the only configured third-party runtime network dependency.

The application shell and locally vendored Leaflet assets are cached by a service worker. Imported data remains in IndexedDB. Previously cached map tiles are not managed by DiveAtlas, so the map can require network access even while the rest of the shell works offline.

## GitHub Pages deployment

`.github/workflows/pages.yml` tests the repository and deploys the static root on pushes to `main`. All application and service-worker paths are relative, so the same files work at `/DiveAtlas/`, on localhost, or on a future custom domain.

After merging the first deployment, a repository administrator may need to choose **GitHub Actions** under **Settings → Pages → Build and deployment → Source** once. No Pages base-path configuration or build output directory is required.

## UDDF support and limitations

The parser targets sanitized Shearwater-style UDDF 3.2 documents and handles namespace prefixes by local element name. It imports explicit IDs when available, dive number/date, region/location/site, computer metadata, Buehlmann gradient factors, surface pressure, and waypoint time/depth/temperature/nodeco/GF/CNS/PPO2/mode fields.

Unsupported UDDF versions, malformed XML, missing dive profiles, and profiles without valid time/depth samples are reported per file. Manufacturer-specific extensions outside those fields are ignored. DiveAtlas does not edit or export UDDF, synchronize between devices, fetch dive files from cloud services, or cache the global map for fully offline navigation.

## License

MIT
