import { APP_VERSION, BACKUP_FORMAT, BACKUP_VERSION } from "./config.js";
import { getAll, mergeLibrary, replaceLibrary } from "./db.js";

const REQUIRED_ARRAYS = ["dives", "profiles", "mappings", "imports"];

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid backup: ${message}`);
}

function uniqueStrings(records, key, label) {
  const values = records.map((record) => record?.[key]);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} keys are missing`);
  assert(new Set(values).size === values.length, `${label} keys are duplicated`);
  return new Set(values);
}

function validateData(data) {
  const diveIds = uniqueStrings(data.dives, "id", "dive");
  const profileIds = uniqueStrings(data.profiles, "diveId", "profile");
  uniqueStrings(data.mappings, "key", "mapping");
  uniqueStrings(data.imports, "recordId", "import");

  data.dives.forEach((dive) => {
    assert(typeof dive.contentHash === "string" && dive.contentHash, `dive ${dive.id} has no content hash`);
    assert(typeof dive.location === "string" && typeof dive.site === "string", `dive ${dive.id} has invalid site text`);
    assert(dive.computer && typeof dive.computer === "object", `dive ${dive.id} has invalid computer metadata`);
    assert(dive.decompression && typeof dive.decompression === "object", `dive ${dive.id} has invalid decompression metadata`);
  });
  data.profiles.forEach((profile) => {
    assert(diveIds.has(profile.diveId), `profile ${profile.diveId} has no dive`);
    assert(Array.isArray(profile.samples), `profile ${profile.diveId} has invalid samples`);
    assert(
      profile.samples.every(
        (sample) => Number.isFinite(sample?.time) && Number.isFinite(sample?.depth),
      ),
      `profile ${profile.diveId} has an invalid time/depth sample`,
    );
  });
  assert(
    [...diveIds].every((id) => profileIds.has(id)),
    "one or more dive profiles are missing",
  );
  data.mappings.forEach((mapping) => {
    assert(typeof mapping.location === "string" && mapping.location, `mapping ${mapping.key} has no location`);
    assert(typeof mapping.site === "string" && mapping.site, `mapping ${mapping.key} has no site`);
    assert(
      Number.isFinite(mapping.latitude) && mapping.latitude >= -90 && mapping.latitude <= 90,
      `mapping ${mapping.key} has invalid latitude`,
    );
    assert(
      Number.isFinite(mapping.longitude) && mapping.longitude >= -180 && mapping.longitude <= 180,
      `mapping ${mapping.key} has invalid longitude`,
    );
    assert(typeof mapping.confidence === "string" && mapping.confidence, `mapping ${mapping.key} has no confidence`);
  });
  data.imports.forEach((record) => {
    assert(typeof record.sourceHash === "string" && record.sourceHash, `import ${record.recordId} has no source hash`);
    assert(Array.isArray(record.diveIds), `import ${record.recordId} has invalid dive IDs`);
    assert(
      record.diveIds.every((id) => typeof id === "string" && diveIds.has(id)),
      `import ${record.recordId} refers to a missing dive`,
    );
    assert(["complete", "conflict"].includes(record.status), `import ${record.recordId} has invalid status`);
  });
  (data.settings ?? []).forEach((record) => {
    assert(typeof record?.key === "string" && record.key, "a setting key is missing");
  });
}

export async function createBackup(databasePromise) {
  const [dives, profiles, mappings, imports, settings] = await Promise.all(
    ["dives", "profiles", "mappings", "imports", "settings"].map((store) =>
      getAll(store, databasePromise),
    ),
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    data: { dives, profiles, mappings, imports, settings },
  };
}

export function validateBackup(backup) {
  if (!backup || backup.format !== BACKUP_FORMAT) {
    throw new Error("This is not a DiveAtlas backup");
  }
  if (backup.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version ${backup.version}`);
  }
  if (!backup.data || REQUIRED_ARRAYS.some((key) => !Array.isArray(backup.data[key]))) {
    throw new Error("Backup data is incomplete");
  }
  if (backup.data.settings !== undefined && !Array.isArray(backup.data.settings)) {
    throw new Error("Backup settings are invalid");
  }
  validateData(backup.data);
  return backup.data;
}

export async function restoreBackup(backup, mode, databasePromise) {
  const data = validateBackup(backup);
  if (mode === "replace") {
    await replaceLibrary(data, databasePromise);
    return {
      addedDives: data.dives.length,
      addedMappings: data.mappings.length,
      conflicts: [],
    };
  }
  if (mode === "merge") return mergeLibrary(data, databasePromise);
  throw new Error("Restore mode must be merge or replace");
}
