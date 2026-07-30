import { describe, expect, it } from "vitest";
import { profilePath, renderProfileChart } from "../src/profile-chart.js";
import {
  filterDives,
  filterDivesToBounds,
  monthlyDiveCounts,
  sortDives,
} from "../src/view-model.js";

const dives = [
  {
    id: "one",
    number: 1,
    dateTime: "2024-01-10T10:00:00Z",
    location: "Island",
    site: "Wall",
    region: "Atlantic",
    maxDepth: 18,
    durationSeconds: 1800,
  },
  {
    id: "two",
    number: 2,
    dateTime: "2025-02-10T10:00:00Z",
    location: "Island",
    site: "Reef",
    region: "Atlantic",
    maxDepth: 32,
    durationSeconds: 3600,
  },
];

it("combines location, site, date, and text filters", () => {
  expect(
    filterDives(dives, {
      location: "Island",
      site: "Wall",
      from: "2024-01-01",
      to: "2024-12-31",
      search: "atlantic",
    }),
  ).toEqual([dives[0]]);
});

it("filters by minimum depth, duration, and date range", () => {
  expect(
    filterDives(dives, {
      minDepth: 30,
      minDuration: 45,
      from: "2025-01-01",
      to: "2025-12-31",
    }),
  ).toEqual([dives[1]]);
});

it("sorts the flat dive list by any visible column", () => {
  const sorted = sortDives(
    [
      { ...dives[0], country: "Spain" },
      { ...dives[1], country: "France" },
      { ...dives[0], id: "three", number: 3, site: "Arch", country: "Spain" },
    ],
    "site",
    "asc",
  );
  expect(sorted.map((dive) => dive.site)).toEqual(["Arch", "Reef", "Wall"]);
  expect(sortDives(sorted, "country", "asc").map((dive) => dive.country)).toEqual([
    "France",
    "Spain",
    "Spain",
  ]);
});

it("filters mapped dives to the visible map bounds", () => {
  const mapped = [
    ...dives.map((dive, index) => ({ ...dive, mappingKey: `key-${index}` })),
    { ...dives[0], id: "unmatched", mappingKey: "missing" },
  ];
  const mappings = new Map([
    ["key-0", { latitude: 10, longitude: 20 }],
    ["key-1", { latitude: 50, longitude: 60 }],
  ]);
  expect(
    filterDivesToBounds(mapped, mappings, {
      south: 0,
      west: 0,
      north: 20,
      east: 30,
    }),
  ).toEqual([mapped[0], mapped[2]]);
});

it("builds monthly counts across the full selected date range", () => {
  const counts = monthlyDiveCounts(dives, "2024-01-01", "2025-03-31");
  expect(counts).toHaveLength(15);
  expect(counts[0]).toEqual({ month: "2024-01", count: 1 });
  expect(counts.find(({ month }) => month === "2024-08")).toEqual({
    month: "2024-08",
    count: 0,
  });
  expect(counts.find(({ month }) => month === "2025-02")).toEqual({
    month: "2025-02",
    count: 1,
  });
  expect(counts.at(-1)).toEqual({ month: "2025-03", count: 0 });
});

describe("profile rendering", () => {
  const samples = [
    { time: 0, depth: 0, temperature: 20 },
    { time: 60, depth: 20, temperature: 18 },
    { time: 120, depth: 0, temperature: 19 },
  ];

  it("creates a valid depth-over-time path", () => {
    expect(profilePath(samples, 720, 280)).toMatch(/^M32\.00,32\.00 L360\.00,248\.00/);
  });

  it("renders an accessible native SVG chart", () => {
    const container = document.createElement("div");
    renderProfileChart(container, samples);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("1 depth profile over dive time");
    expect(container.querySelectorAll("path")).toHaveLength(2);
    expect(container.querySelectorAll(".profile-axis-label")).toHaveLength(10);
  });

  it("overlays multiple profiles without a persistent legend", () => {
    const container = document.createElement("div");
    renderProfileChart(container, [
      { label: "Dive 1", samples },
      {
        label: "Dive 2",
        samples: samples.map((sample) => ({ ...sample, depth: sample.depth * 0.5 })),
      },
    ]);
    expect(container.querySelector("svg").getAttribute("aria-label")).toBe(
      "2 depth profiles over dive time",
    );
    expect(container.querySelectorAll(".profile-line")).toHaveLength(2);
    expect(container.querySelector(".profile-legend")).toBeNull();
  });

  it("shows dive metadata, depth, and elapsed minutes in a hover tooltip", () => {
    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 720,
      height: 280,
    });
    renderProfileChart(container, [
      {
        label: "Dive 7 · Blue Wall",
        number: 7,
        location: "Example Island",
        site: "Blue Wall",
        samples,
      },
    ]);
    const svg = container.querySelector("svg");
    svg.getBoundingClientRect = container.getBoundingClientRect;
    svg.dispatchEvent(new PointerEvent("pointermove", { clientX: 360, clientY: 120 }));
    expect(container.querySelector(".chart-tooltip").textContent).toContain(
      "Dive 7 · Example Island · Blue Wall · 20.0 m · 1.0 min",
    );
  });

  it("reports unavailable profiles without hiding profiles that can be drawn", () => {
    const container = document.createElement("div");
    renderProfileChart(container, [
      { label: "Dive 1", samples: [] },
      { label: "Dive 2", samples },
    ]);
    expect(container.querySelectorAll(".profile-line")).toHaveLength(1);
    expect(container.querySelector(".profile-unavailable").textContent).toBe(
      "1 selected dive has no profile samples.",
    );

    renderProfileChart(container, [{ label: "Dive 1", samples: [] }]);
    expect(container.textContent).toBe(
      "No profile samples are available for the selected dive.",
    );
  });

  it("handles large profile selections without spreading every sample", () => {
    const container = document.createElement("div");
    const largeSelection = Array.from({ length: 200 }, (_, diveIndex) => ({
      label: `Dive ${diveIndex}`,
      samples: Array.from({ length: 650 }, (_, sampleIndex) => ({
        time: sampleIndex,
        depth: sampleIndex % 50,
      })),
    }));
    expect(() => renderProfileChart(container, largeSelection)).not.toThrow();
    expect(container.querySelectorAll(".profile-line")).toHaveLength(200);
    expect(container.querySelector(".profile-legend")).toBeNull();
  });
});
