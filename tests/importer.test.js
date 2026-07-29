import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAll, openDatabase } from "../src/db.js";
import { importSources } from "../src/importer.js";

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
