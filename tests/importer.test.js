import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAll, openDatabase } from "../src/db.js";
import { importSources } from "../src/importer.js";
import { sha256Text } from "../src/utils.js";

const uddf = await readFile(join(process.cwd(), "tests", "fixtures", "representative.uddf"), "utf8");
const csv = await readFile(join(process.cwd(), "tests", "fixtures", "mappings.csv"), "utf8");
const databases = [];

function source(name, text) {
  return {
    name,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

function diveBlock(xml) {
  return xml.match(/      <dive id="[^"]+">[\s\S]*?      <\/dive>/)[0];
}

async function testDatabase() {
  const name = `diveatlas-import-${crypto.randomUUID()}`;
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

describe("incremental import flow", () => {
  it("imports valid files in a mixed selection while reporting invalid files", async () => {
    const database = await testDatabase();
    const { results } = await importSources(
      [
        source("representative.uddf", uddf),
        source("locations.csv", csv),
        source("broken.uddf", "<not-xml"),
      ],
      { databasePromise: database, yieldToMain: async () => {} },
    );
    expect(results.map((result) => result.type)).toEqual(["success", "success", "error"]);
    expect(await getAll("dives", database)).toHaveLength(1);
    expect(await getAll("mappings", database)).toHaveLength(2);
    expect(await getAll("mappings", database)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ country: "Spain", countryCode: "ES" }),
      ]),
    );
  });

  it("persists dives that have metadata but no profile samples", async () => {
    const database = await testDatabase();
    const metadataOnly = uddf.replace(/        <samples>[\s\S]*?        <\/samples>\r?\n/, "");
    const outcome = await importSources([source("metadata-only.uddf", metadataOnly)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    expect(outcome.results[0]).toMatchObject({
      type: "success",
      message: "1 dive(s) imported",
    });
    expect(await getAll("dives", database)).toEqual([
      expect.objectContaining({
        number: 42,
        sampleCount: 0,
        durationSeconds: 180,
        decoDive: false,
      }),
    ]);
    expect(await getAll("profiles", database)).toEqual([
      expect.objectContaining({ samples: [] }),
    ]);
  });

  it("enriches duration only when reprocessing the exact legacy source", async () => {
    const database = await testDatabase();
    const metadataOnly = uddf.replace(/        <samples>[\s\S]*?        <\/samples>\r?\n/, "");
    await importSources([source("metadata-only.uddf", metadataOnly)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    const sourceHash = await sha256Text(metadataOnly);
    const connection = await database;
    const [storedDive] = await getAll("dives", database);
    const transaction = connection.transaction(["dives", "imports"], "readwrite");
    transaction.objectStore("dives").put({
      ...storedDive,
      durationSeconds: null,
      contentHash: "legacy-content-hash",
    });
    transaction.objectStore("imports").put({
      recordId: `source:${sourceHash}`,
      sourceHash,
      diveIds: [storedDive.id],
      sourceName: "metadata-only.uddf",
      importedAt: new Date().toISOString(),
      importVersion: 2,
      status: "complete",
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });

    const outcome = await importSources([source("metadata-only.uddf", metadataOnly)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });

    expect(outcome.results[0]).toMatchObject({ type: "success" });
    expect(outcome.results[0].message).toContain("1 stored dive(s) enriched");
    expect(await getAll("dives", database)).toEqual([
      expect.objectContaining({ durationSeconds: 180 }),
    ]);
  });

  it("reprocesses legacy source hashes to recover previously omitted profileless dives", async () => {
    const database = await testDatabase();
    await importSources([source("original.uddf", uddf)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    const original = diveBlock(uddf);
    const profileless = original
      .replace('id="synthetic-dive-42"', 'id="profileless"')
      .replace("<divenumber>42</divenumber>", "<divenumber>45</divenumber>")
      .replace("<datetime>2025-06-15T09:30:00Z</datetime>", "<datetime>2025-06-18T09:30:00Z</datetime>")
      .replace(/        <samples>[\s\S]*?        <\/samples>\r?\n/, "");
    const combined = uddf.replace(original, `${original}\n${profileless}`);
    const sourceHash = await sha256Text(combined);
    const connection = await database;
    const existingDiveId = (await getAll("dives", database))[0].id;
    const transaction = connection.transaction("imports", "readwrite");
    transaction.objectStore("imports").put({
      recordId: `source:${sourceHash}`,
      sourceHash,
      diveIds: [existingDiveId],
      sourceName: "combined.uddf",
      status: "complete",
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });

    const outcome = await importSources([source("combined.uddf", combined)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    expect(outcome.results[0].message).toContain("1 dive(s) imported");
    expect(await getAll("dives", database)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ number: 42, sampleCount: 4 }),
        expect.objectContaining({ number: 45, sampleCount: 0 }),
      ]),
    );
  });

  it("skips exact sources and reports changed dives with the same stable identity", async () => {
    const database = await testDatabase();
    await importSources([source("first.uddf", uddf)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    const duplicate = await importSources([source("copy.uddf", uddf)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    expect(duplicate.results[0].message).toContain("Exact source already imported");

    const changedText = uddf.replace("<depth>24.2</depth>", "<depth>25.2</depth>");
    const changed = await importSources([source("changed.uddf", changedText)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    expect(changed.results[0].message).toContain("1 conflict");
    expect((await getAll("dives", database))[0].maxDepth).toBe(24.2);
  });

  it("reports explicit NDL provenance that conflicts with an inferred decompression record", async () => {
    const database = await testDatabase();
    const missing = uddf.replaceAll(/<nodecotime>[^<]+<\/nodecotime>/g, "");
    const explicit = missing.replace(
      "<depth>24.2</depth>",
      "<depth>24.2</depth><nodecotime>0</nodecotime>",
    );
    await importSources([source("unknown.uddf", missing)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    const outcome = await importSources([source("explicit-deco.uddf", explicit)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    expect(outcome.results[0].message).toContain("1 conflict");
    expect(await getAll("dives", database)).toEqual([
      expect.objectContaining({ decoDive: true }),
    ]);
  });

  it("stores different dives whose source documents both use id 1", async () => {
    const database = await testDatabase();
    const first = uddf.replace('id="synthetic-dive-42"', 'id="1"');
    const second = first
      .replace("<datetime>2025-06-15T09:30:00Z</datetime>", "<datetime>2025-06-16T09:30:00Z</datetime>")
      .replace("<name>Blue Wall</name>", "<name>South Reef</name>");
    const firstResult = await importSources([source("first.uddf", first)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    const secondResult = await importSources([source("second.uddf", second)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    const dives = await getAll("dives", database);
    expect(firstResult.results[0].type).toBe("success");
    expect(secondResult.results[0].type).toBe("success");
    expect(dives).toHaveLength(2);
    expect(new Set(dives.map((dive) => dive.id)).size).toBe(2);
  });

  it("deduplicates a re-export that changes only its document-local ID", async () => {
    const database = await testDatabase();
    await importSources([source("first.uddf", uddf)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    const reexport = uddf.replace('id="synthetic-dive-42"', 'id="7"');
    const outcome = await importSources([source("reexport.uddf", reexport)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });
    expect(outcome.results[0].message).toContain("1 normalized duplicate");
    expect(outcome.results[0].message).not.toContain("conflict");
    expect(await getAll("dives", database)).toHaveLength(1);
  });

  it("isolates conflicting same-source identities without losing unrelated dives", async () => {
    const database = await testDatabase();
    const original = diveBlock(uddf).replace('id="synthetic-dive-42"', 'id="1"');
    const collision = original.replace("<depth>24.2</depth>", "<depth>25.2</depth>");
    const unrelated = original
      .replace('id="1"', 'id="2"')
      .replace("<divenumber>42</divenumber>", "<divenumber>43</divenumber>")
      .replace("<datetime>2025-06-15T09:30:00Z</datetime>", "<datetime>2025-06-17T09:30:00Z</datetime>");
    const multiDive = uddf.replace(diveBlock(uddf), `${original}\n${collision}\n${unrelated}`);

    const outcome = await importSources([source("multi.uddf", multiDive)], {
      databasePromise: database,
      yieldToMain: async () => {},
    });

    expect(outcome.results[0].type).toBe("warning");
    expect(outcome.results[0].message).toContain("1 dive(s) imported");
    expect(outcome.results[0].message).toContain("1 conflict");
    expect(outcome.results[0].issues[0]).toContain("all colliding entries were skipped");
    expect(await getAll("dives", database)).toEqual([
      expect.objectContaining({ number: 43 }),
    ]);
  });

  it("processes 501 files incrementally with progress and yielding", async () => {
    const database = await testDatabase();
    const files = Array.from({ length: 501 }, (_, index) => source(`dive-${index}.uddf`, ""));
    let yields = 0;
    const workerClient = {
      process: async (file) => ({
        sourceHash: `hash-${file.name}`,
        text: uddf
          .replaceAll("synthetic-dive-42", `synthetic-${file.name}`)
          .replace("<divenumber>42</divenumber>", `<divenumber>${file.name.match(/\d+/)[0]}</divenumber>`),
      }),
    };
    const progress = [];
    const outcome = await importSources(files, {
      databasePromise: database,
      workerClient,
      onProgress: (index) => progress.push(index),
      yieldToMain: async () => {
        yields += 1;
      },
    });
    expect(outcome.results).toHaveLength(501);
    expect(await getAll("dives", database)).toHaveLength(501);
    expect(yields).toBe(501);
    expect(progress.at(-1)).toBe(501);
  }, 20000);

  it("reports cancellation at the actual processed count", async () => {
    const database = await testDatabase();
    let cancelled = false;
    const progress = [];
    const outcome = await importSources(
      [source("first.uddf", uddf), source("second.uddf", uddf)],
      {
        databasePromise: database,
        isCancelled: () => cancelled,
        onProgress: (index, name, status) => progress.push({ index, name, status }),
        yieldToMain: async () => {
          cancelled = true;
        },
      },
    );
    expect(outcome).toMatchObject({ processedCount: 1, totalCount: 2, cancelled: true });
    expect(progress.at(-1)).toEqual({
      index: 1,
      name: "",
      status: { cancelled: true },
    });
  });
});
