import { afterEach, describe, expect, it } from "vitest";
import {
  addDive,
  addDiveSource,
  applyMappings,
  clearLibrary,
  getAll,
  getRecord,
  hasSourceHash,
  openDatabase,
  removeDives,
} from "../src/db.js";
import { stableDiveId } from "../src/utils.js";

const databases = [];

async function testDatabase() {
  const name = `diveatlas-test-${crypto.randomUUID()}`;
  const connection = openDatabase(indexedDB, name);
  databases.push({ name, connection });
  return connection;
}

afterEach(async () => {
  for (const { name, connection } of databases.splice(0)) {
    (await connection).close();
    indexedDB.deleteDatabase(name);
  }
});

function records(id = "uddf:test-1") {
  return {
    dive: {
      id,
      number: 1,
      contentHash: "content",
      sourceName: "one.uddf",
      location: "Place",
      site: "Site",
      computer: {},
      decompression: {},
    },
    profile: { diveId: id, samples: [{ time: 0, depth: 0 }] },
  };
}

describe("IndexedDB persistence", () => {
  it("persists normalized dive and profile records", async () => {
    const database = await testDatabase();
    const { dive, profile } = records();
    await addDive(dive, profile, "source", database);
    expect(await getRecord("dives", dive.id, database)).toEqual(dive);
    expect(await getRecord("profiles", dive.id, database)).toEqual(profile);
    expect(await getAll("imports", database)).toHaveLength(1);
  });

  it("atomically removes a dive, profile, and dependent import history", async () => {
    const database = await testDatabase();
    const first = records("uddf:first");
    const second = records("uddf:second");
    await addDive(first.dive, first.profile, "source-a", database);
    await addDive(second.dive, second.profile, "source-b", database);
    await removeDives([first.dive.id], database);
    expect(await getRecord("dives", first.dive.id, database)).toBeUndefined();
    expect(await getRecord("profiles", first.dive.id, database)).toBeUndefined();
    expect(await getAll("imports", database)).toEqual([
      expect.objectContaining({ diveIds: [second.dive.id] }),
    ]);
  });

  it("invalidates a multi-dive source marker when any constituent dive is removed", async () => {
    const database = await testDatabase();
    const first = records("uddf:first");
    const second = records("uddf:second");
    await addDiveSource(
      [first, second],
      "shared-source",
      "multi.uddf",
      [first.dive.id, second.dive.id],
      true,
      database,
    );
    expect(await hasSourceHash("shared-source", database)).toBe(true);
    await removeDives([first.dive.id], database);
    expect(await hasSourceHash("shared-source", database)).toBe(false);
    expect(await getRecord("dives", second.dive.id, database)).toEqual(second.dive);
  });

  it("reprocesses import records created before the current import format", async () => {
    const database = await testDatabase();
    const { dive, profile } = records();
    await addDive(dive, profile, "legacy-source", database);
    const connection = await database;
    const transaction = connection.transaction("imports", "readwrite");
    transaction.objectStore("imports").put({
      recordId: "source:legacy-source",
      sourceHash: "legacy-source",
      diveIds: [dive.id],
      status: "complete",
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    expect(await hasSourceHash("legacy-source", database)).toBe(false);
  });

  it("replaces a conflicting mapping with the newest imported coordinates", async () => {
    const database = await testDatabase();
    const first = {
      key: "a\u001fb",
      location: "A",
      site: "B",
      latitude: 10,
      longitude: 20,
      confidence: "Exact",
    };
    await applyMappings([first], "merge", database);
    const result = await applyMappings([{ ...first, latitude: 11 }], "merge", database);
    expect(result.conflicts).toHaveLength(1);
    expect(result.updated).toBe(1);
    expect(await getRecord("mappings", first.key, database)).toEqual({
      ...first,
      latitude: 11,
    });
  });

  it("atomically clears every library store", async () => {
    const database = await testDatabase();
    const { dive, profile } = records();
    await addDive(dive, profile, "source", database);
    await applyMappings(
      [
        {
          key: "a\u001fb",
          location: "A",
          site: "B",
          latitude: 10,
          longitude: 20,
          confidence: "Exact",
        },
      ],
      "merge",
      database,
    );

    await clearLibrary(database);

    await Promise.all(
      ["dives", "profiles", "mappings", "imports", "settings"].map(async (store) => {
        expect(await getAll(store, database)).toEqual([]);
      }),
    );
  });

  it("atomically migrates v1 dive, profile, and import identity references", async () => {
    const name = `diveatlas-v1-${crypto.randomUUID()}`;
    const legacyRequest = indexedDB.open(name, 1);
    const legacy = await new Promise((resolve, reject) => {
      legacyRequest.onupgradeneeded = () => {
        const database = legacyRequest.result;
        const dives = database.createObjectStore("dives", { keyPath: "id" });
        dives.createIndex("dateTime", "dateTime");
        dives.createIndex("mappingKey", "mappingKey");
        database.createObjectStore("profiles", { keyPath: "diveId" });
        database.createObjectStore("mappings", { keyPath: "key" });
        const imports = database.createObjectStore("imports", { keyPath: "recordId" });
        imports.createIndex("sourceHash", "sourceHash", { unique: true });
        imports.createIndex("diveIds", "diveIds", { multiEntry: true });
        database.createObjectStore("settings", { keyPath: "key" });
      };
      legacyRequest.onsuccess = () => resolve(legacyRequest.result);
      legacyRequest.onerror = () => reject(legacyRequest.error);
    });
    const dive = {
      ...records("uddf:1").dive,
      uddfId: "1",
      dateTime: "2025-01-01T10:00:00Z",
    };
    const profile = { diveId: dive.id, samples: [{ time: 0, depth: 0 }] };
    const transaction = legacy.transaction(["dives", "profiles", "imports"], "readwrite");
    transaction.objectStore("dives").put(dive);
    transaction.objectStore("profiles").put(profile);
    transaction.objectStore("imports").put({
      recordId: "source:legacy",
      sourceHash: "legacy",
      diveIds: [dive.id],
      status: "complete",
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();

    const connection = openDatabase(indexedDB, name);
    databases.push({ name, connection });
    const migratedId = stableDiveId(dive);
    expect(await getRecord("dives", migratedId, connection)).toEqual({
      ...dive,
      id: migratedId,
      decoDive: false,
    });

    expect(await getRecord("profiles", migratedId, connection)).toEqual({
      ...profile,
      diveId: migratedId,
    });
    expect(await getAll("imports", connection)).toEqual([
      expect.objectContaining({ diveIds: [migratedId] }),
    ]);
  });

  it("uses DiveViz decompression inference when migrating stored profiles", async () => {
    const name = `diveatlas-v2-${crypto.randomUUID()}`;
    const request = indexedDB.open(name, 2);
    const legacy = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        const dives = database.createObjectStore("dives", { keyPath: "id" });
        dives.createIndex("dateTime", "dateTime");
        dives.createIndex("mappingKey", "mappingKey");
        database.createObjectStore("profiles", { keyPath: "diveId" });
        database.createObjectStore("mappings", { keyPath: "key" });
        const imports = database.createObjectStore("imports", { keyPath: "recordId" });
        imports.createIndex("sourceHash", "sourceHash", { unique: true });
        imports.createIndex("diveIds", "diveIds", { multiEntry: true });
        database.createObjectStore("settings", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const { dive, profile } = records("meta|legacy");
    profile.samples.push({ time: 60, depth: 20, nodeco: 0 });
    const transaction = legacy.transaction(["dives", "profiles"], "readwrite");
    transaction.objectStore("dives").put(dive);
    transaction.objectStore("profiles").put(profile);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();

    const connection = openDatabase(indexedDB, name);
    databases.push({ name, connection });
    expect(await getRecord("dives", dive.id, connection)).toEqual({
      ...dive,
      decoDive: true,
    });
  });

  it("recalculates decompression status when migrating v3 data", async () => {
    const name = `diveatlas-v3-${crypto.randomUUID()}`;
    const request = indexedDB.open(name, 3);
    const legacy = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        const dives = database.createObjectStore("dives", { keyPath: "id" });
        dives.createIndex("dateTime", "dateTime");
        dives.createIndex("mappingKey", "mappingKey");
        database.createObjectStore("profiles", { keyPath: "diveId" });
        database.createObjectStore("mappings", { keyPath: "key" });
        const imports = database.createObjectStore("imports", { keyPath: "recordId" });
        imports.createIndex("sourceHash", "sourceHash", { unique: true });
        imports.createIndex("diveIds", "diveIds", { multiEntry: true });
        database.createObjectStore("settings", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const { dive, profile } = records("meta|v3");
    dive.decoDive = null;
    profile.samples.push({ time: 60, depth: 20, nodeco: 0 });
    const transaction = legacy.transaction(["dives", "profiles"], "readwrite");
    transaction.objectStore("dives").put(dive);
    transaction.objectStore("profiles").put(profile);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();

    const connection = openDatabase(indexedDB, name);
    databases.push({ name, connection });
    expect(await getRecord("dives", dive.id, connection)).toEqual({
      ...dive,
      decoDive: true,
    });
  });

  it("classifies stored profileless dives as no-decompression when migrating v4 data", async () => {
    const name = `diveatlas-v4-${crypto.randomUUID()}`;
    const request = indexedDB.open(name, 4);
    const legacy = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        const dives = database.createObjectStore("dives", { keyPath: "id" });
        dives.createIndex("dateTime", "dateTime");
        dives.createIndex("mappingKey", "mappingKey");
        database.createObjectStore("profiles", { keyPath: "diveId" });
        database.createObjectStore("mappings", { keyPath: "key" });
        const imports = database.createObjectStore("imports", { keyPath: "recordId" });
        imports.createIndex("sourceHash", "sourceHash", { unique: true });
        imports.createIndex("diveIds", "diveIds", { multiEntry: true });
        database.createObjectStore("settings", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const { dive, profile } = records("meta|v4-profileless");
    dive.decoDive = null;
    profile.samples = [];
    const transaction = legacy.transaction(["dives", "profiles"], "readwrite");
    transaction.objectStore("dives").put(dive);
    transaction.objectStore("profiles").put(profile);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();

    const connection = openDatabase(indexedDB, name);
    databases.push({ name, connection });
    expect(await getRecord("dives", dive.id, connection)).toEqual({
      ...dive,
      decoDive: false,
    });
  });

  it("deduplicates identical v1 re-exports with different local IDs", async () => {
    const name = `diveatlas-v1-duplicates-${crypto.randomUUID()}`;
    const request = indexedDB.open(name, 1);
    const legacy = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        const dives = database.createObjectStore("dives", { keyPath: "id" });
        dives.createIndex("dateTime", "dateTime");
        dives.createIndex("mappingKey", "mappingKey");
        database.createObjectStore("profiles", { keyPath: "diveId" });
        database.createObjectStore("mappings", { keyPath: "key" });
        const imports = database.createObjectStore("imports", { keyPath: "recordId" });
        imports.createIndex("sourceHash", "sourceHash", { unique: true });
        imports.createIndex("diveIds", "diveIds", { multiEntry: true });
        database.createObjectStore("settings", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const base = {
      ...records("uddf:1").dive,
      uddfId: "1",
      dateTime: "2025-01-01T10:00:00Z",
    };
    const reexport = { ...base, id: "uddf:7", uddfId: "7", contentHash: "different-v1-hash" };
    const transaction = legacy.transaction(["dives", "profiles", "imports"], "readwrite");
    transaction.objectStore("dives").put(base);
    transaction.objectStore("dives").put(reexport);
    transaction.objectStore("profiles").put({
      diveId: base.id,
      samples: [{ time: 0, depth: 0 }],
    });
    transaction.objectStore("profiles").put({
      diveId: reexport.id,
      samples: [{ time: 0, depth: 0 }],
    });
    transaction.objectStore("imports").put({
      recordId: "source:legacy",
      sourceHash: "legacy",
      diveIds: [base.id, reexport.id],
      status: "complete",
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();

    const connection = openDatabase(indexedDB, name);
    databases.push({ name, connection });
    const migratedId = stableDiveId(base);
    expect(await getAll("dives", connection)).toEqual([
      expect.objectContaining({ id: migratedId }),
    ]);
    expect(await getAll("profiles", connection)).toEqual([
      expect.objectContaining({ diveId: migratedId }),
    ]);
    expect(await getAll("imports", connection)).toEqual([
      expect.objectContaining({ diveIds: [migratedId] }),
    ]);
  });
});
