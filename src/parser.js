import { deriveDecoDive, mappingKey, stableDiveId } from "./utils.js";

const UNKNOWN = "Unknown";

function descendants(node, localName) {
  if (!node) return [];
  const namespaced = node.getElementsByTagNameNS?.("*", localName);
  if (namespaced?.length) return [...namespaced];
  return [...node.getElementsByTagName?.("*") ?? []].filter(
    (element) => element.localName === localName || element.nodeName.split(":").pop() === localName,
  );
}

function first(node, localName) {
  return descendants(node, localName)[0] ?? null;
}

function text(node, localName, fallback = "") {
  return first(node, localName)?.textContent?.trim() || fallback;
}

function numeric(node, localName) {
  const raw = text(node, localName, "");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function directDiveProfiles(root) {
  const profileData = first(root, "profiledata");
  if (!profileData) return [];
  const repetitionGroup = first(profileData, "repetitiongroup");
  const candidates = descendants(repetitionGroup ?? profileData, "dive");
  return candidates.filter((candidate) => first(candidate, "samples"));
}

function parseDateTime(information) {
  const combined = text(information, "datetime");
  if (combined) return combined;
  const date = text(information, "date");
  const time = text(information, "time", "00:00:00");
  return date ? `${date}T${time.replace(/Z$/, "")}Z` : "";
}

function convertTemperature(value) {
  if (value === null) return null;
  return value > 150 ? value - 273.15 : value;
}

function parseWaypoint(waypoint) {
  const depth = numeric(waypoint, "depth");
  const nodeco = numeric(waypoint, "nodecotime");
  return {
    time: numeric(waypoint, "divetime"),
    depth,
    temperature: convertTemperature(numeric(waypoint, "temperature")),
    nodeco: nodeco ?? (depth !== null && depth >= 3 ? 0 : 5940),
    nodecoReported: nodeco !== null,
    gf99: numeric(waypoint, "gradientfactor"),
    cns: numeric(waypoint, "cns"),
    ppo2: numeric(waypoint, "calculatedpo2"),
    mode: text(waypoint, "divemode", ""),
  };
}

function profileSummary(samples) {
  const finite = (key) => samples.map((sample) => sample[key]).filter(Number.isFinite);
  const depths = finite("depth");
  const times = finite("time");
  const temperatures = finite("temperature");
  const maximum = (values) => (values.length ? Math.max(...values) : null);
  const minimum = (values) => (values.length ? Math.min(...values) : null);
  return {
    durationSeconds: maximum(times),
    maxDepth: maximum(depths),
    minTemperature: minimum(temperatures),
    maxTemperature: maximum(temperatures),
    maxGf99: maximum(finite("gf99")),
    maxCns: maximum(finite("cns")),
    maxPpo2: maximum(finite("ppo2")),
    decoDive: deriveDecoDive(samples),
  };
}

export function parseUddf(xmlText, sourceName = "UDDF file") {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (descendants(document, "parsererror").length) {
    throw new Error(`${sourceName}: malformed XML`);
  }

  const root = document.documentElement;
  if (!root || root.localName !== "uddf") {
    throw new Error(`${sourceName}: expected a UDDF document`);
  }

  const version = root.getAttribute("version") || "";
  const namespace = root.namespaceURI || "";
  if (version && !version.startsWith("3.2")) {
    throw new Error(`${sourceName}: unsupported UDDF version ${version}`);
  }
  if (namespace && !namespace.includes("/uddf/3.2")) {
    throw new Error(`${sourceName}: unsupported UDDF namespace ${namespace}`);
  }

  const siteContainer = first(root, "divesite");
  const siteNode = first(siteContainer, "site");
  const site = text(siteNode, "name", UNKNOWN);
  const location = text(first(siteNode, "geography") ?? siteNode, "location", UNKNOWN);
  const region = location === UNKNOWN ? UNKNOWN : location.split(",")[0].trim();

  const computer = first(first(root, "equipment"), "divecomputer");
  const decoContainer = first(root, "decomodel");
  const decoNode = decoContainer?.children?.[0] ?? null;
  const profiles = directDiveProfiles(root);
  if (!profiles.length) {
    throw new Error(`${sourceName}: no dive profile with samples was found`);
  }

  return profiles.map((profile) => {
    const information = first(profile, "informationbeforedive");
    const samples = descendants(first(profile, "samples"), "waypoint")
      .map(parseWaypoint)
      .filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.depth));
    if (!samples.length) {
      throw new Error(`${sourceName}: dive profile has no valid time/depth waypoints`);
    }

    const summary = profileSummary(samples);
    const dive = {
      schemaVersion: 1,
      uddfId: profile.getAttribute("id") || "",
      number: numeric(information, "divenumber"),
      dateTime: parseDateTime(information),
      region,
      location,
      site,
      computer: {
        id: computer?.getAttribute("id") || "",
        manufacturer: text(first(computer, "manufacturer"), "name", ""),
        model: text(computer, "model", ""),
        serial: text(computer, "serialnumber", ""),
      },
      decompression: {
        model: decoNode?.localName || "",
        id: decoNode?.getAttribute("id") || "",
        gfLow: numeric(decoNode, "gradientfactorlow"),
        gfHigh: numeric(decoNode, "gradientfactorhigh"),
      },
      surfacePressure: numeric(information, "surfacepressure"),
      ...summary,
      sampleCount: samples.length,
      importedAt: new Date().toISOString(),
      sourceName,
    };
    dive.id = stableDiveId(dive);
    return { dive, profile: { diveId: dive.id, samples } };
  });
}

function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (quoted && character === '"' && csvText[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && csvText[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseCoordinateCsv(csvText, sourceName = "CSV file") {
  const rows = parseCsvRows(csvText.replace(/^\uFEFF/, ""));
  if (!rows.length) throw new Error(`${sourceName}: CSV is empty`);

  const headers = rows[0].map((header) => header.trim());
  const headerLookup = new Map(headers.map((header, index) => [header.toLowerCase(), index]));
  const required = ["Location", "Site", "Latitude", "Longitude"];
  const missing = required.filter((header) => !headerLookup.has(header.toLowerCase()));
  if (missing.length) {
    throw new Error(`${sourceName}: missing required header(s): ${missing.join(", ")}`);
  }

  const get = (row, header) => row[headerLookup.get(header.toLowerCase())]?.trim() ?? "";
  const mappings = [];
  const issues = [];
  const seen = new Map();
  rows.slice(1).forEach((row, offset) => {
    const line = offset + 2;
    const location = get(row, "Location");
    const site = get(row, "Site");
    const latitudeText = get(row, "Latitude");
    const longitudeText = get(row, "Longitude");
    const latitude = latitudeText === "" ? Number.NaN : Number(latitudeText);
    const longitude = longitudeText === "" ? Number.NaN : Number(longitudeText);
    const confidence = get(row, "Confidence") || "Exact";
    if (!location || !site) {
      issues.push({ line, type: "invalid", message: "Location and Site are required" });
      return;
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      issues.push({ line, type: "invalid", message: "Latitude must be between -90 and 90" });
      return;
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      issues.push({ line, type: "invalid", message: "Longitude must be between -180 and 180" });
      return;
    }
    const key = mappingKey(location, site);
    const mapping = {
      key,
      location,
      site,
      latitude,
      longitude,
      confidence,
      importedAt: new Date().toISOString(),
      sourceName,
    };
    const prior = seen.get(key);
    if (prior) {
      const same =
        prior.latitude === latitude &&
        prior.longitude === longitude &&
        prior.confidence.toLowerCase() === confidence.toLowerCase();
      issues.push({
        line,
        type: same ? "duplicate" : "conflict",
        message: same
          ? `Duplicate mapping for ${location} / ${site}`
          : `Conflicting mapping for ${location} / ${site}; first row retained`,
      });
      return;
    }
    seen.set(key, mapping);
    mappings.push(mapping);
  });

  return { mappings, issues, headers };
}
