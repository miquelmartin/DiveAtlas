import { describe, expect, it } from "vitest";
import { profilePath, renderProfileChart } from "../src/profile-chart.js";
import { filterDives, filterDivesToBounds } from "../src/view-model.js";

const dives = [
  {
    id: "one",
    number: 1,
    dateTime: "2024-01-10T10:00:00Z",
    location: "Island",
    site: "Wall",
    region: "Atlantic",
  },
  {
    id: "two",
    number: 2,
    dateTime: "2025-02-10T10:00:00Z",
    location: "Island",
    site: "Reef",
    region: "Atlantic",
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
  });

  it("overlays multiple profiles with a legend", () => {
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
    expect([...container.querySelectorAll(".profile-legend li")].map((item) => item.textContent))
      .toEqual(["Dive 1", "Dive 2"]);
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
  });
});
