import { afterEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup, validateBackup } from "../src/backup.js";
import { addDive, applyMappings, getAll, openDatabase } from "../src/db.js";

const databases = [];

async function testDatabase() {
  const name = `diveatlas-backup-${crypto.randomUUID()}`;
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

it("round-trips a complete library into empty storage", async () => {
  const source = await testDatabase();
  const target = await testDatabase();
  const dive = {
    id: "uddf:backup",
    number: 99,
    contentHash: "hash",
    sourceName: "backup.uddf",
    location: "Place",
    site: "Site",
    computer: {},
    decompression: {},
  };
  const profile = { diveId: dive.id, samples: [{ time: 0, depth: 0 }, { time: 60, depth: 20 }] };
  const mapping = {
    key: "place\u001fsite",
    location: "Place",
    site: "Site",
    latitude: 1,
    longitude: 2,
    confidence: "Exact",
  };
  await addDive(dive, profile, "source-hash", source);
  await applyMappings([mapping], "merge", source);

  const backup = await createBackup(source);
  const result = await restoreBackup(backup, "replace", target);
  expect(result).toMatchObject({ addedDives: 1, addedMappings: 1, conflicts: [] });
  expect(await getAll("dives", target)).toEqual([dive]);
  expect(await getAll("profiles", target)).toEqual([profile]);
  expect(await getAll("mappings", target)).toEqual([mapping]);
  expect(await getAll("imports", target)).toHaveLength(1);
});

describe("backup validation and merge", () => {
  it("rejects unknown formats, versions, and missing profiles", () => {
    expect(() => validateBackup({})).toThrow("not a DiveAtlas backup");
    expect(() =>
      validateBackup({ format: "diveatlas-backup", version: 999, data: {} }),
    ).toThrow("Unsupported backup version");
    expect(() =>
      validateBackup({
        format: "diveatlas-backup",
        version: 1,
        data: {
          dives: [{
            id: "missing",
            contentHash: "hash",
            location: "Place",
            site: "Site",
            computer: {},
            decompression: {},
          }],
          profiles: [],
          mappings: [],
          imports: [],
        },
      }),
    ).toThrow("one or more dive profiles are missing");
  });

  it("reports merge conflicts without overwriting", async () => {
    const database = await testDatabase();
    const stored = {
      id: "uddf:same",
      number: 1,
      contentHash: "stored",
      sourceName: "a",
      location: "Place",
      site: "Site",
      computer: {},
      decompression: {},
    };
    await addDive(stored, { diveId: stored.id, samples: [] }, "source", database);
    const backup = {
      format: "diveatlas-backup",
      version: 1,
      data: {
        dives: [{ ...stored, contentHash: "changed" }],
        profiles: [{ diveId: stored.id, samples: [{ time: 1, depth: 1 }] }],
        mappings: [],
        imports: [],
      },
    };
    const result = await restoreBackup(backup, "merge", database);
    expect(result.conflicts).toHaveLength(1);
    expect((await getAll("dives", database))[0].contentHash).toBe("stored");
  });

  it("rejects malformed records before replace can clear stored data", async () => {
    const database = await testDatabase();
    const stored = {
      id: "uddf:protected",
      contentHash: "stored",
      sourceName: "a",
      location: "Place",
      site: "Site",
      computer: {},
      decompression: {},
    };
    await addDive(stored, { diveId: stored.id, samples: [] }, "source", database);
    const malformed = {
      format: "diveatlas-backup",
      version: 1,
      data: {
        dives: [stored],
        profiles: [{ diveId: stored.id, samples: [] }],
        mappings: [{ location: "Missing key" }],
        imports: [],
      },
    };
    await expect(restoreBackup(malformed, "replace", database)).rejects.toThrow(
      "Invalid backup",
    );
    expect(await getAll("dives", database)).toEqual([stored]);
  });
});
