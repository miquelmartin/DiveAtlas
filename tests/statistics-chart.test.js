import { describe, expect, it } from "vitest";
import { renderSelectionStatistics } from "../src/statistics-chart.js";

describe("selected dive statistics", () => {
  it("renders a dive-type donut and metric distributions", () => {
    const container = document.createElement("div");
    renderSelectionStatistics(
      container,
      [
        {
          dateTime: "2025-01-02T10:00:00Z",
          decoDive: true,
          maxDepth: 30,
          durationSeconds: 3600,
          minTemperature: 18,
          maxCns: 12,
          maxGf99: 70,
        },
        {
          dateTime: "2025-02-03T10:00:00Z",
          decoDive: false,
          maxDepth: 20,
          durationSeconds: 2400,
          minTemperature: 20,
          maxCns: 5,
          maxGf99: 55,
        },
        {
          dateTime: "2025-02-10T10:00:00Z",
          decoDive: null,
          maxDepth: null,
          durationSeconds: null,
          minTemperature: null,
          maxCns: null,
          maxGf99: null,
        },
      ],
      {
        from: "2025-01-01",
        to: "2025-02-28",
        libraryDives: [
          { maxDepth: 30, durationSeconds: 3600, maxCns: 12, maxGf99: 70 },
          { maxDepth: 20, durationSeconds: 2400, maxCns: 5, maxGf99: 55 },
          { maxDepth: 50, durationSeconds: 7200, maxCns: 130, maxGf99: 110 },
        ],
      },
    );

    expect(container.querySelector(".donut-total").textContent).toBe("3");
    expect(container.querySelector(".dive-type-summary h3").textContent).toBe(
      "Decompression Dives",
    );
    expect(container.querySelector(".dive-type-summary svg").getAttribute("aria-label")).toBe(
      "1 decompression, 1 no-decompression, and 1 unknown dives",
    );
    expect(container.querySelectorAll(".donut-segment")).toHaveLength(3);
    expect([...container.querySelectorAll(".donut-segment title")].map((item) => item.textContent))
      .toEqual([
        "1 decompression dive",
        "1 no-decompression dive",
        "1 unknown dive",
      ]);
    expect(
      [...container.querySelectorAll(".donut-segment")].map((item) => ({
        tabindex: item.getAttribute("tabindex"),
        label: item.getAttribute("aria-label"),
      })),
    ).toEqual([
      { tabindex: "0", label: "1 decompression dive" },
      { tabindex: "0", label: "1 no-decompression dive" },
      { tabindex: "0", label: "1 unknown dive" },
    ]);
    expect(container.querySelectorAll(".monthly-bar")).toHaveLength(2);
    expect([...container.querySelectorAll(".distribution-chart h3")].map((item) => item.textContent))
      .toEqual([
        "Maximum depth",
        "Duration",
        "Minimum temperature",
        "Maximum CNS",
        "Maximum GF99",
      ]);
    expect(container.querySelectorAll(".selection-grid > section")).toHaveLength(7);
    expect(container.querySelectorAll(".distribution-bar")).toHaveLength(100);
    expect(
      container.querySelector(".distribution-chart svg").getAttribute("aria-label"),
    ).toBe("Maximum depth distribution: 2 of 3 selected dives have data");
    const axisRange = (title) => {
      const chart = [...container.querySelectorAll(".distribution-chart")].find(
        (item) => item.querySelector("h3").textContent === title,
      );
      return [...chart.querySelectorAll(".selection-axis-label")].map((item) => item.textContent);
    };
    expect(axisRange("Maximum depth")).toEqual(["0.0 m", "50.0 m"]);
    expect(axisRange("Duration")).toEqual(["0.0 min", "120.0 min"]);
    expect(axisRange("Maximum CNS")).toEqual(["0.0 %", "130.0 %"]);
    expect(axisRange("Maximum GF99")).toEqual(["0.0 %", "110.0 %"]);
  });

  it("shows empty states for selected dives without profile summaries", () => {
    const container = document.createElement("div");
    renderSelectionStatistics(container, [{ dateTime: "2025-01-01", decoDive: null }]);
    expect(container.querySelector(".donut-total").textContent).toBe("1");
    expect(container.querySelectorAll(".distribution-chart > p")).toHaveLength(5);
  });

  it("omits zero-count dive types from the legend", () => {
    const container = document.createElement("div");
    renderSelectionStatistics(container, [
      { dateTime: "2025-01-01", decoDive: true },
      { dateTime: "2025-01-02", decoDive: false },
    ]);
    expect(container.querySelector(".donut-legend").textContent).not.toContain("Unknown");
  });
});
