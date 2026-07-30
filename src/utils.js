export function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
}

export function mappingKey(location, site) {
  return `${normalizeKey(location)}\u001f${normalizeKey(site)}`;
}

function identityPart(value) {
  return encodeURIComponent(normalizeKey(value)).toLowerCase();
}

function canonicalDateTime(value) {
  const text = String(value ?? "").trim();
  if (!text || !/(?:z|[+-]\d{2}:\d{2})$/i.test(text)) return text;
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? text : new Date(timestamp).toISOString();
}

export function stableDiveId(dive) {
  const metadata = [
    dive.number,
    canonicalDateTime(dive.dateTime),
    dive.location,
    dive.site,
  ].map(identityPart);
  return `meta|${metadata.join("|")}`;
}

export function normalizedDivePayload(dive, profile) {
  const {
    id: _id,
    importedAt: _importedAt,
    sourceName: _sourceName,
    contentHash: _contentHash,
    uddfId: _uddfId,
    decoDive: _decoDive,
    ...stableDive
  } = dive;
  const { diveId: _diveId, samples = [], ...stableProfile } = profile;
  return {
    dive: stableDive,
    profile: {
      ...stableProfile,
      samples: samples.map(({ nodecoReported, ...sample }) =>
        nodecoReported === true ? { ...sample, nodecoReported: true } : sample,
      ),
    },
  };
}

export function deriveDecoDive(samples = []) {
  if (!samples.length) return false;
  return samples.some(
    (sample) => Number.isFinite(sample.depth) && sample.depth >= 3 && sample.nodeco === 0,
  );
}

function payloadToken(payload) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= BigInt(payload.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function canonicalizeLibraryIdentities(data) {
  const profileById = new Map(data.profiles.map((profile) => [profile.diveId, profile]));
  const groups = new Map();
  data.dives.forEach((dive) => {
    const profile = profileById.get(dive.id);
    if (!profile) return;
    const canonicalId = stableDiveId(dive);
    const candidate = {
      dive: {
        ...dive,
        decoDive: typeof dive.decoDive === "boolean" ? dive.decoDive : deriveDecoDive(profile.samples),
      },
      profile,
      payload: "",
    };
    candidate.payload = stableStringify(normalizedDivePayload(candidate.dive, profile));
    if (!groups.has(canonicalId)) groups.set(canonicalId, []);
    groups.get(canonicalId).push(candidate);
  });

  const idMap = new Map();
  const dives = [];
  const profiles = [];
  const issues = [];
  for (const [canonicalId, group] of groups) {
    group.sort((left, right) =>
      `${left.dive.importedAt ?? ""}\u001f${left.dive.id}`.localeCompare(
        `${right.dive.importedAt ?? ""}\u001f${right.dive.id}`,
      ),
    );
    const canonical = group[0];
    idMap.set(canonical.dive.id, canonicalId);
    dives.push({ ...canonical.dive, id: canonicalId });
    profiles.push({ ...canonical.profile, diveId: canonicalId });

    group.slice(1).forEach((candidate) => {
      if (candidate.payload === canonical.payload) {
        idMap.set(candidate.dive.id, canonicalId);
        return;
      }
      const preservedId = `${canonicalId}|conflict-${payloadToken(candidate.payload)}`;
      idMap.set(candidate.dive.id, preservedId);
      dives.push({ ...candidate.dive, id: preservedId });
      profiles.push({ ...candidate.profile, diveId: preservedId });
      issues.push(
        `Legacy dives ${canonical.dive.id} and ${candidate.dive.id} share canonical metadata but differ; both were preserved`,
      );
    });
  }

  const imports = data.imports.map((record) => ({
    ...record,
    diveIds: [...new Set(record.diveIds.map((id) => idMap.get(id)).filter(Boolean))],
  }));
  const settings = [...(data.settings ?? [])];
  if (issues.length) {
    const existing = settings.find((record) => record.key === "identityMigrationIssues");
    const value = [...(Array.isArray(existing?.value) ? existing.value : []), ...issues];
    const record = { key: "identityMigrationIssues", value, updatedAt: new Date().toISOString() };
    const index = settings.findIndex((item) => item.key === record.key);
    if (index >= 0) settings[index] = record;
    else settings.push(record);
  }
  return { ...data, dives, profiles, imports, settings, identityIssues: issues };
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
