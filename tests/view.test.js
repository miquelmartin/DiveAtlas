import { describe, expect, it } from "vitest";
import { profilePath, renderProfileChart } from "../src/profile-chart.js";
import { filterDives } from "../src/view-model.js";

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
    expect(svg.getAttribute("aria-label")).toBe("Depth over dive time");
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });
});
