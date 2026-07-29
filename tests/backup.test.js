import { afterEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup, validateBackup } from "../src/backup.js";
import { addDive, applyMappings, getAll, openDatabase } from "../src/db.js";
import { stableDiveId } from "../src/utils.js";

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
    number: 99,
    contentHash: "hash",
    sourceName: "backup.uddf",
    location: "Place",
    site: "Site",
    computer: {},
    decompression: {},
  };
  dive.id = stableDiveId(dive);
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
      number: 1,
      contentHash: "stored",
      sourceName: "a",
      location: "Place",
      site: "Site",
      computer: {},
      decompression: {},
    };
    stored.id = stableDiveId(stored);
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

  it("canonicalizes v1 backup IDs and deduplicates changed-ID re-exports", async () => {
    const database = await testDatabase();
    const base = {
      id: "uddf:1",
      uddfId: "1",
      number: 1,
      dateTime: "2025-01-01T10:00:00Z",
      contentHash: "legacy-one",
      sourceName: "one.uddf",
      location: "Place",
      site: "Site",
      computer: {},
      decompression: {},
    };
    const reexport = {
      ...base,
      id: "uddf:7",
      uddfId: "7",
      contentHash: "legacy-seven",
      sourceName: "seven.uddf",
    };
    const backup = {
      format: "diveatlas-backup",
      version: 1,
      data: {
        dives: [base, reexport],
        profiles: [
          { diveId: base.id, samples: [{ time: 0, depth: 0 }] },
          { diveId: reexport.id, samples: [{ time: 0, depth: 0 }] },
        ],
        mappings: [],
        imports: [{
          recordId: "source:legacy",
          sourceHash: "legacy",
          diveIds: [base.id, reexport.id],
          status: "complete",
        }],
      },
    };

    const result = await restoreBackup(backup, "replace", database);
    const canonicalId = stableDiveId(base);
    expect(result.addedDives).toBe(1);
    expect(await getAll("dives", database)).toEqual([
      expect.objectContaining({ id: canonicalId }),
    ]);
    expect(await getAll("profiles", database)).toEqual([
      expect.objectContaining({ diveId: canonicalId }),
    ]);
    expect(await getAll("imports", database)).toEqual([
      expect.objectContaining({ diveIds: [canonicalId] }),
    ]);
  });

  it("keeps preserved conflict IDs stable across repeated backup restores", async () => {
    const database = await testDatabase();
    const base = {
      id: "uddf:1",
      uddfId: "1",
      number: 1,
      dateTime: "2025-01-01T10:00:00Z",
      contentHash: "first",
      sourceName: "one.uddf",
      location: "Place",
      site: "Site",
      computer: {},
      decompression: {},
    };
    const changed = {
      ...base,
      id: "uddf:7",
      uddfId: "7",
      contentHash: "second",
      sourceName: "seven.uddf",
    };
    const backup = {
      format: "diveatlas-backup",
      version: 1,
      data: {
        dives: [base, changed],
        profiles: [
          { diveId: base.id, samples: [{ time: 0, depth: 0 }] },
          { diveId: changed.id, samples: [{ time: 0, depth: 5 }] },
        ],
        mappings: [],
        imports: [],
      },
    };
    await restoreBackup(backup, "replace", database);
    const firstIds = (await getAll("dives", database)).map((dive) => dive.id).sort();
    expect(firstIds).toHaveLength(2);
    expect(firstIds.some((id) => id.includes("|conflict-"))).toBe(true);

    const currentBackup = await createBackup(database);
    const result = await restoreBackup(currentBackup, "merge", database);
    const secondIds = (await getAll("dives", database)).map((dive) => dive.id).sort();
    expect(result.addedDives).toBe(0);
    expect(secondIds).toEqual(firstIds);
  });
});
