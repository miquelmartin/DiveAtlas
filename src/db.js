import { DB_NAME, DB_VERSION } from "./config.js";

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

function upgrade(database) {
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

export function openDatabase(factory = globalThis.indexedDB, name = DB_NAME) {
  const useDefaultConnection = factory === globalThis.indexedDB && name === DB_NAME;
  if (useDefaultConnection && defaultConnection) return defaultConnection;
  const connection = new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) upgrade(request.result);
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
  return record?.status === "complete";
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
    status: complete ? "complete" : "conflict",
  });
  await transactionDone(transaction);
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
      if (existing.contentHash !== dive.contentHash) {
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
