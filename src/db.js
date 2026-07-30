import { DB_NAME, DB_VERSION, DIVE_IMPORT_VERSION } from "./config.js";
import {
  canonicalizeLibraryIdentities,
  deriveDecoDive,
  normalizedDivePayload,
  stableStringify,
} from "./utils.js";

let defaultConnection;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function createSchema(database) {
  const dives = database.createObjectStore("dives", { keyPath: "id" });
  dives.createIndex("dateTime", "dateTime");
  dives.createIndex("mappingKey", "mappingKey");
  database.createObjectStore("profiles", { keyPath: "diveId" });
  database.createObjectStore("mappings", { keyPath: "key" });
  const imports = database.createObjectStore("imports", { keyPath: "recordId" });
  imports.createIndex("sourceHash", "sourceHash", { unique: true });
  imports.createIndex("diveIds", "diveIds", { multiEntry: true });
  database.createObjectStore("settings", { keyPath: "key" });
}

function migrateV1(transaction) {
  const stores = {
    dives: transaction.objectStore("dives"),
    profiles: transaction.objectStore("profiles"),
    imports: transaction.objectStore("imports"),
    settings: transaction.objectStore("settings"),
  };
  const loaded = {};
  const load = (name) => {
    const request = stores[name].getAll();
    request.onsuccess = () => {
      loaded[name] = request.result;
      if (loaded.dives && loaded.profiles && loaded.imports) migrateRecords();
    };
  };
  const migrateRecords = () => {
    const migrated = canonicalizeLibraryIdentities({
      dives: loaded.dives,
      profiles: loaded.profiles,
      imports: loaded.imports,
      mappings: [],
      settings: [],
    });

    stores.dives.clear();
    stores.profiles.clear();
    migrated.dives.forEach((dive) => stores.dives.put(dive));
    migrated.profiles.forEach((profile) => stores.profiles.put(profile));
    migrated.imports.forEach((record) => stores.imports.put(record));
    migrated.settings.forEach((record) => stores.settings.put(record));
  };
  load("dives");
  load("profiles");
  load("imports");
}

function migrateV2(transaction) {
  const dives = transaction.objectStore("dives");
  const profiles = transaction.objectStore("profiles");
  const diveRequest = dives.getAll();
  const profileRequest = profiles.getAll();
  const loaded = {};
  const update = () => {
    if (!loaded.dives || !loaded.profiles) return;
    const profileById = new Map(loaded.profiles.map((profile) => [profile.diveId, profile]));
    loaded.dives.forEach((dive) => {
      if (typeof dive.decoDive === "boolean") return;
      dives.put({
        ...dive,
        decoDive: deriveDecoDive(profileById.get(dive.id)?.samples),
      });
    });
  };
  diveRequest.onsuccess = () => {
    loaded.dives = diveRequest.result;
    update();
  };
  profileRequest.onsuccess = () => {
    loaded.profiles = profileRequest.result;
    update();
  };
}

function migrateV3(transaction) {
  const dives = transaction.objectStore("dives");
  const profiles = transaction.objectStore("profiles");
  const diveRequest = dives.getAll();
  const profileRequest = profiles.getAll();
  const loaded = {};
  const update = () => {
    if (!loaded.dives || !loaded.profiles) return;
    const profileById = new Map(loaded.profiles.map((profile) => [profile.diveId, profile]));
    loaded.dives.forEach((dive) => {
      dives.put({
        ...dive,
        decoDive: deriveDecoDive(profileById.get(dive.id)?.samples),
      });
    });
  };
  diveRequest.onsuccess = () => {
    loaded.dives = diveRequest.result;
    update();
  };
  profileRequest.onsuccess = () => {
    loaded.profiles = profileRequest.result;
    update();
  };
}

function migrateV4(transaction) {
  const dives = transaction.objectStore("dives");
  const profiles = transaction.objectStore("profiles");
  const diveRequest = dives.getAll();
  const profileRequest = profiles.getAll();
  const loaded = {};
  const update = () => {
    if (!loaded.dives || !loaded.profiles) return;
    const profileById = new Map(loaded.profiles.map((profile) => [profile.diveId, profile]));
    loaded.dives.forEach((dive) => {
      if (profileById.get(dive.id)?.samples?.length || dive.decoDive === false) return;
      dives.put({ ...dive, decoDive: false });
    });
  };
  diveRequest.onsuccess = () => {
    loaded.dives = diveRequest.result;
    update();
  };
  profileRequest.onsuccess = () => {
    loaded.profiles = profileRequest.result;
    update();
  };
}

export function openDatabase(factory = globalThis.indexedDB, name = DB_NAME) {
  const useDefaultConnection = factory === globalThis.indexedDB && name === DB_NAME;
  if (useDefaultConnection && defaultConnection) return defaultConnection;
  const connection = new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) createSchema(request.result);
      if (event.oldVersion === 1) migrateV1(request.transaction);
      if (event.oldVersion === 2) migrateV2(request.transaction);
      if (event.oldVersion === 3) migrateV3(request.transaction);
      if (event.oldVersion === 4) migrateV4(request.transaction);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other DiveAtlas tabs to upgrade storage"));
  });
  if (useDefaultConnection) defaultConnection = connection;
  return connection;
}

export async function closeDatabase() {
  if (!defaultConnection) return;
  (await defaultConnection).close();
  defaultConnection = undefined;
}

export async function getAll(storeName, databasePromise = openDatabase()) {
  const database = await databasePromise;
  return requestResult(database.transaction(storeName).objectStore(storeName).getAll());
}

export async function getRecord(storeName, key, databasePromise = openDatabase()) {
  const database = await databasePromise;
  return requestResult(database.transaction(storeName).objectStore(storeName).get(key));
}

export async function hasSourceHash(sourceHash, databasePromise = openDatabase()) {
  const database = await databasePromise;
  const record = await requestResult(
    database.transaction("imports").objectStore("imports").get(`source:${sourceHash}`),
  );
  return (
    record?.status === "complete" &&
    record.importVersion === DIVE_IMPORT_VERSION
  );
}

export async function addDive(
  dive,
  profile,
  sourceHash,
  databasePromise = openDatabase(),
) {
  return addDiveSource(
    [{ dive, profile }],
    sourceHash,
    dive.sourceName,
    [dive.id],
    true,
    databasePromise,
  );
}

export async function addDiveSource(
  records,
  sourceHash,
  sourceName,
  diveIds,
  complete,
  databasePromise = openDatabase(),
) {
  const database = await databasePromise;
  const transaction = database.transaction(["dives", "profiles", "imports"], "readwrite");
  records.forEach(({ dive, profile }) => {
    transaction.objectStore("dives").add(dive);
    transaction.objectStore("profiles").add(profile);
  });
  transaction.objectStore("imports").put({
    recordId: `source:${sourceHash}`,
    sourceHash,
    diveIds,
    sourceName,
    importedAt: new Date().toISOString(),
    importVersion: DIVE_IMPORT_VERSION,
    status: complete ? "complete" : "conflict",
  });
  await transactionDone(transaction);
}

function isDurationOnlyChange(existingDive, existingProfile, record) {
  if (
    !existingProfile ||
    !Number.isFinite(record.dive.durationSeconds) ||
    existingDive.durationSeconds === record.dive.durationSeconds
  ) {
    return false;
  }
  const existingDuration = Number.isFinite(existingDive.durationSeconds)
    ? existingDive.durationSeconds
    : null;
  const incomingWithExistingDuration = {
    ...record.dive,
    durationSeconds: existingDuration,
  };
  const normalizedExisting = {
    ...existingDive,
    durationSeconds: existingDuration,
  };
  return (
    stableStringify(normalizedDivePayload(normalizedExisting, existingProfile)) ===
    stableStringify(normalizedDivePayload(incomingWithExistingDuration, record.profile))
  );
}

export async function importDiveSource(
  records,
  sourceHash,
  sourceName,
  sourceHasConflicts,
  databasePromise = openDatabase(),
) {
  const database = await databasePromise;
  const transaction = database.transaction(["dives", "profiles", "imports"], "readwrite");
  const done = transactionDone(transaction);
  const dives = transaction.objectStore("dives");
  const profiles = transaction.objectStore("profiles");
  const imports = transaction.objectStore("imports");
  const previousImport = await requestResult(imports.get(`source:${sourceHash}`));
  const isFormatUpgrade =
    Boolean(previousImport) && previousImport.importVersion !== DIVE_IMPORT_VERSION;
  const conflicts = [];
  let added = 0;
  let duplicates = 0;
  let enriched = 0;

  for (const record of records) {
    const existing = await requestResult(dives.get(record.dive.id));
    if (!existing) {
      dives.add(record.dive);
      profiles.add(record.profile);
      added += 1;
      continue;
    }

    let same = existing.contentHash === record.dive.contentHash;
    if (!same) {
      const existingProfile = await requestResult(profiles.get(record.dive.id));
      same =
        Boolean(existingProfile) &&
        stableStringify(normalizedDivePayload(existing, existingProfile)) ===
          stableStringify(normalizedDivePayload(record.dive, record.profile));
    }
    if (same) {
      duplicates += 1;
      if (existing.contentHash !== record.dive.contentHash) {
        dives.put({ ...existing, contentHash: record.dive.contentHash });
      }
    } else if (
      isFormatUpgrade &&
      isDurationOnlyChange(
        existing,
        await requestResult(profiles.get(record.dive.id)),
        record,
      )
    ) {
      dives.put({
        ...existing,
        durationSeconds: record.dive.durationSeconds,
        contentHash: record.dive.contentHash,
      });
      enriched += 1;
    } else {
      conflicts.push(
        `Dive ${record.dive.number ?? record.dive.id} has the same identity but changed content; stored version retained`,
      );
    }
  }

  imports.put({
    recordId: `source:${sourceHash}`,
    sourceHash,
    diveIds: records.map((record) => record.dive.id),
    sourceName,
    importedAt: new Date().toISOString(),
    importVersion: DIVE_IMPORT_VERSION,
    status: sourceHasConflicts || conflicts.length ? "conflict" : "complete",
  });
  await done;
  return { added, duplicates, enriched, conflicts };
}

export async function removeDives(ids, databasePromise = openDatabase()) {
  const database = await databasePromise;
  const transaction = database.transaction(["dives", "profiles", "imports"], "readwrite");
  const diveStore = transaction.objectStore("dives");
  const profileStore = transaction.objectStore("profiles");
  const importIndex = transaction.objectStore("imports").index("diveIds");
  for (const id of ids) {
    diveStore.delete(id);
    profileStore.delete(id);
    const keys = await requestResult(importIndex.getAllKeys(id));
    keys.forEach((key) => transaction.objectStore("imports").delete(key));
  }
  await transactionDone(transaction);
}

export async function applyMappings(
  mappings,
  mode = "merge",
  databasePromise = openDatabase(),
) {
  const database = await databasePromise;
  const transaction = database.transaction("mappings", "readwrite");
  const store = transaction.objectStore("mappings");
  const conflicts = [];
  let added = 0;
  if (mode === "replace") store.clear();
  for (const mapping of mappings) {
    const existing = mode === "merge" ? await requestResult(store.get(mapping.key)) : undefined;
    if (existing) {
      const same =
        existing.latitude === mapping.latitude &&
        existing.longitude === mapping.longitude &&
        existing.confidence.toLowerCase() === mapping.confidence.toLowerCase();
      if (!same) {
        conflicts.push({
          key: mapping.key,
          message: `Existing mapping for ${mapping.location} / ${mapping.site} was retained`,
        });
      }
      if (same && !existing.country && mapping.country) {
        store.put({
          ...existing,
          country: mapping.country,
          countryCode: mapping.countryCode ?? "",
        });
      }
      continue;
    }
    store.put(mapping);
    added += 1;
  }
  await transactionDone(transaction);
  return { added, conflicts };
}

export async function removeMappings(keys, databasePromise = openDatabase()) {
  const database = await databasePromise;
  const transaction = database.transaction("mappings", "readwrite");
  keys.forEach((key) => transaction.objectStore("mappings").delete(key));
  await transactionDone(transaction);
}

export async function replaceLibrary(data, databasePromise = openDatabase()) {
  const database = await databasePromise;
  const stores = ["dives", "profiles", "mappings", "imports", "settings"];
  const transaction = database.transaction(stores, "readwrite");
  try {
    stores.forEach((name) => transaction.objectStore(name).clear());
    data.dives.forEach((record) => transaction.objectStore("dives").put(record));
    data.profiles.forEach((record) => transaction.objectStore("profiles").put(record));
    data.mappings.forEach((record) => transaction.objectStore("mappings").put(record));
    data.imports.forEach((record) => transaction.objectStore("imports").put(record));
    (data.settings ?? []).forEach((record) => transaction.objectStore("settings").put(record));
  } catch (error) {
    transaction.abort();
    throw error;
  }
  await transactionDone(transaction);
}

export async function mergeLibrary(data, databasePromise = openDatabase()) {
  const database = await databasePromise;
  const stores = ["dives", "profiles", "mappings", "imports", "settings"];
  const transaction = database.transaction(stores, "readwrite");
  const conflicts = [];
  let addedDives = 0;
  let addedMappings = 0;

  for (const dive of data.dives) {
    const existing = await requestResult(transaction.objectStore("dives").get(dive.id));
    if (existing) {
      const existingProfile = await requestResult(
        transaction.objectStore("profiles").get(dive.id),
      );
      const incomingProfile = data.profiles.find((item) => item.diveId === dive.id);
      const same =
        existing.contentHash === dive.contentHash ||
        (existingProfile &&
          incomingProfile &&
          stableStringify(normalizedDivePayload(existing, existingProfile)) ===
            stableStringify(normalizedDivePayload(dive, incomingProfile)));
      if (!same) {
        conflicts.push(`Dive ${dive.number ?? dive.id} differs from the stored dive`);
      }
      continue;
    }
    transaction.objectStore("dives").put(dive);
    const profile = data.profiles.find((item) => item.diveId === dive.id);
    if (profile) transaction.objectStore("profiles").put(profile);
    data.imports
      .filter((item) => item.diveIds.includes(dive.id))
      .forEach((item) => transaction.objectStore("imports").put(item));
    addedDives += 1;
  }

  for (const mapping of data.mappings) {
    const existing = await requestResult(transaction.objectStore("mappings").get(mapping.key));
    if (existing) {
      if (
        existing.latitude !== mapping.latitude ||
        existing.longitude !== mapping.longitude
      ) {
        conflicts.push(`Mapping ${mapping.location} / ${mapping.site} differs`);
      }
      continue;
    }
    transaction.objectStore("mappings").put(mapping);
    addedMappings += 1;
  }
  await transactionDone(transaction);
  return { addedDives, addedMappings, conflicts };
}
