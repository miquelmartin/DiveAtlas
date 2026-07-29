import { afterEach, describe, expect, it } from "vitest";
import {
  addDive,
  addDiveSource,
  applyMappings,
  getAll,
  getRecord,
  hasSourceHash,
  openDatabase,
  removeDives,
} from "../src/db.js";

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

  it("never overwrites a conflicting mapping during merge", async () => {
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
    expect(await getRecord("mappings", first.key, database)).toEqual(first);
  });
});
