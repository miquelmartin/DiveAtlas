import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCoordinateCsv, parseUddf } from "../src/parser.js";
import {
  mappingKey,
  normalizedDivePayload,
  normalizeKey,
  stableDiveId,
  stableStringify,
} from "../src/utils.js";

const fixture = (name) =>
  readFile(join(process.cwd(), "tests", "fixtures", name), "utf8");

describe("UDDF parser", () => {
  it("parses representative Shearwater metadata and profile fields", async () => {
    const [{ dive, profile }] = parseUddf(
      await fixture("representative.uddf"),
      "representative.uddf",
    );
    expect(dive.id).toBe(
      "meta|42|2025-06-15t09%3a30%3a00.000z|example%20island%2c%20test%20region|blue%20wall",
    );
    expect(dive.number).toBe(42);
    expect(dive.location).toBe("Example Island, Test Region");
    expect(dive.site).toBe("Blue Wall");
    expect(dive.computer.model).toBe("Perdix 2");
    expect(dive.decompression).toMatchObject({ model: "buehlmann", gfLow: 40, gfHigh: 85 });
    expect(dive.maxDepth).toBe(24.2);
    expect(dive.durationSeconds).toBe(180);
    expect(dive.decoDive).toBe(false);
    expect(profile.samples).toHaveLength(4);
    expect(profile.samples[0].temperature).toBeCloseTo(20);
    expect(profile.samples[2].nodeco).toBe(0);
    expect(profile.samples[1]).toMatchObject({ gf99: 35, cns: 2, ppo2: 1.1 });
  });

  it("rejects malformed and unsupported documents with actionable errors", async () => {
    const malformed = await fixture("malformed.uddf");
    expect(() => parseUddf(malformed, "bad.uddf")).toThrow(
      "bad.uddf: malformed XML",
    );
    expect(() =>
      parseUddf('<uddf version="2.2"><profiledata/></uddf>', "old.uddf"),
    ).toThrow("unsupported UDDF version");
  });

  it("does not turn missing waypoint values into zero-valued samples", async () => {
    const invalidWaypoint = (await fixture("representative.uddf"))
      .replace("<divetime>0</divetime><depth>0</depth>", "<divetime></divetime><depth></depth>")
      .replace("<divetime>60</divetime><depth>12.5</depth>", "<temperature>290</temperature>");
    const [{ profile }] = parseUddf(invalidWaypoint, "missing-values.uddf");
    expect(profile.samples).toHaveLength(2);
    expect(profile.samples[0].time).toBe(120);
  });

  it("distinguishes explicit decompression from missing no-decompression data", async () => {
    const source = await fixture("representative.uddf");
    const missing = source.replaceAll(/<nodecotime>[^<]+<\/nodecotime>/g, "");
    const explicitDeco = source.replace(
      "<depth>24.2</depth>",
      "<depth>24.2</depth><nodecotime>0</nodecotime>",
    );
    const missingRecord = parseUddf(missing)[0];
    const explicitRecord = parseUddf(explicitDeco)[0];
    expect(missingRecord.dive.decoDive).toBeNull();
    expect(explicitRecord.dive.decoDive).toBe(true);
    expect(stableStringify(normalizedDivePayload(missingRecord.dive, missingRecord.profile))).not
      .toBe(stableStringify(normalizedDivePayload(explicitRecord.dive, explicitRecord.profile)));
  });

  it("builds a stable metadata identity when an explicit ID is absent", () => {
    const dive = {
      number: 7,
      dateTime: "2024-01-01T10:00:00Z",
      location: "  Red   Sea ",
      site: "THE WALL",
    };
    expect(stableDiveId(dive)).toBe(
      "meta|7|2024-01-01t10%3a00%3a00.000z|red%20sea|the%20wall",
    );
  });

  it("scopes a document-local explicit ID with canonical dive metadata", () => {
    const common = {
      uddfId: "1",
      number: 1,
      dateTime: "2024-01-01T10:00:00Z",
      location: "Red Sea",
    };
    const first = stableDiveId({ ...common, site: "North Wall" });
    const reexport = stableDiveId({ ...common, uddfId: "7", site: "North Wall" });
    const second = stableDiveId({
      ...common,
      dateTime: "2024-01-02T10:00:00+00:00",
      site: "South Wall",
    });
    expect(first).toBe(reexport);
    expect(first).not.toBe(second);
    expect(first).toBe(
      stableDiveId({ ...common, site: "  NORTH   WALL " }),
    );
  });
});

describe("coordinate CSV parser", () => {
  it("accepts extended schemas and defaults blank Confidence to Exact", async () => {
    const result = parseCoordinateCsv(await fixture("mappings.csv"));
    expect(result.headers).toContain("Notes");
    expect(result.mappings).toHaveLength(2);
    expect(result.mappings[1].confidence).toBe("Exact");
  });

  it("requires contract headers", () => {
    expect(() => parseCoordinateCsv("Location,Site\nA,B")).toThrow(
      "missing required header(s): Latitude, Longitude",
    );
  });

  it("validates coordinate ranges without discarding valid rows", () => {
    const result = parseCoordinateCsv(
      "Location,Site,Latitude,Longitude\nA,Valid,10,20\nB,Bad,91,0\nC,Worse,0,-181",
    );
    expect(result.mappings).toHaveLength(1);
    expect(result.issues.map((issue) => issue.type)).toEqual(["invalid", "invalid"]);
  });

  it("reports blank coordinates instead of treating them as zero", () => {
    const result = parseCoordinateCsv(
      "Location,Site,Latitude,Longitude\nA,Blank,,\nB,Valid,0,0",
    );
    expect(result.mappings).toEqual([
      expect.objectContaining({ location: "B", latitude: 0, longitude: 0 }),
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({ line: 2, type: "invalid" }),
    ]);
  });

  it("reports duplicate and conflicting normalized keys and retains the first", () => {
    const result = parseCoordinateCsv(
      "Location,Site,Latitude,Longitude\nRed Sea,Wall,10,20\n red   sea ,WALL,10,20\nRED SEA,wall,11,20",
    );
    expect(result.mappings).toHaveLength(1);
    expect(result.issues.map((issue) => issue.type)).toEqual(["duplicate", "conflict"]);
    expect(result.mappings[0].key).toBe(mappingKey("red sea", "wall"));
    expect(normalizeKey("  RED   SEA ")).toBe("red sea");
  });
});
