import { describe, expect, it } from "vitest";
import { renderSelectionStatistics } from "../src/statistics-chart.js";

describe("selected dive statistics", () => {
  it("renders a dive-type donut and metric distributions", () => {
    const container = document.createElement("div");
    const selectedBins = [];
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
            dateTime: "2025-03-15T10:00:00Z",
            decoDive: null,
            maxDepth: 50,
            durationSeconds: 7200,
            minTemperature: 12,
            maxCns: 130,
            maxGf99: 110,
          },
        ],
        onSelectDives: (dives) => selectedBins.push(dives),
      },
    );

    expect(container.querySelector(".donut-total").textContent).toBe("3");
    expect(container.querySelector(".dive-type-summary h3").textContent).toBe(
      "Decompression Dives",
    );
    expect(container.querySelector(".dive-type-summary svg").getAttribute("aria-label")).toBe(
      "1 decompression, 1 no-decompression, and 1 unknown dives in the library; 3 selected",
    );
    expect(container.querySelectorAll(".donut-segment")).toHaveLength(3);
    expect(container.querySelectorAll(".donut-selection-segment")).toHaveLength(3);
    expect([...container.querySelectorAll(".donut-segment title")].map((item) => item.textContent))
      .toEqual([
        "Decompression · All dives: 1 · Selected dives: 1",
        "No-decompression · All dives: 1 · Selected dives: 1",
        "Unknown · All dives: 1 · Selected dives: 1",
      ]);
    expect(
      [...container.querySelectorAll(".donut-segment")].map((item) => ({
        tabindex: item.getAttribute("tabindex"),
        label: item.getAttribute("aria-label"),
      })),
    ).toEqual([
      {
        tabindex: "0",
        label: "Decompression · All dives: 1 · Selected dives: 1",
      },
      {
        tabindex: "0",
        label: "No-decompression · All dives: 1 · Selected dives: 1",
      },
      {
        tabindex: "0",
        label: "Unknown · All dives: 1 · Selected dives: 1",
      },
    ]);
    expect(container.querySelectorAll(".histogram-chart")).toHaveLength(6);
    expect(container.querySelectorAll(".monthly-histogram .histogram-bar-all")).toHaveLength(3);
    expect(container.querySelectorAll(".monthly-histogram .histogram-bar-selected")).toHaveLength(
      3,
    );
    expect([...container.querySelectorAll(".distribution-chart h3")].map((item) => item.textContent))
      .toEqual([
        "Maximum depth",
        "Duration",
        "Minimum temperature",
        "Maximum CNS",
        "Maximum GF99",
      ]);
    expect(container.querySelectorAll(".selection-grid > section")).toHaveLength(8);
    expect(container.querySelectorAll(".distribution-chart .histogram-bar-all")).toHaveLength(100);
    expect(container.querySelectorAll(".distribution-chart .histogram-bar-selected")).toHaveLength(
      100,
    );
    expect(container.querySelectorAll(".histogram-hit-area")).toHaveLength(103);
    const firstAllBar = container.querySelector(".histogram-bar-all");
    const firstSelectedBar = container.querySelector(".histogram-bar-selected");
    expect(firstSelectedBar.getAttribute("x")).toBe(firstAllBar.getAttribute("x"));
    expect(firstSelectedBar.getAttribute("width")).toBe(firstAllBar.getAttribute("width"));
    expect(container.querySelector(".monthly-histogram svg").getAttribute("aria-label")).toContain(
      "from 2025-01 to 2025-03",
    );
    expect(container.querySelector(".histogram-legend").textContent).toBe(
      "All divesSelected dives",
    );
    expect(container.lastElementChild).toBe(container.querySelector(".histogram-legend"));
    expect(container.querySelectorAll(".scatter-point-all")).toHaveLength(3);
    expect(container.querySelectorAll(".scatter-point-selected")).toHaveLength(2);
    expect(container.querySelectorAll(".scatter-hit-area")).toHaveLength(3);
    expect(container.querySelector(".scatter-chart svg").getAttribute("aria-label")).toBe(
      "Depth versus duration scatter plot for 3 library dives and 2 selected dives",
    );
    expect(container.querySelector(".scatter-chart h3").textContent).toBe("Depth vs duration");
    expect(
      [...container.querySelectorAll(".scatter-axis-y-label")].map((item) => ({
        text: item.textContent,
        y: Number(item.getAttribute("y")),
      })),
    ).toEqual([
      { text: "50.0 m", y: 119 },
      { text: "0 m", y: 9 },
    ]);
    const deepestPoint = [...container.querySelectorAll(".scatter-point-all")].find(
      (point) => Number(point.getAttribute("cy")) === 116,
    );
    expect(deepestPoint).toBeTruthy();
    expect(
      container.querySelector(".distribution-chart svg").getAttribute("aria-label"),
    ).toBe(
      "Maximum depth distribution: 3 of 3 library dives and 2 of 3 selected dives have data",
    );
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
    const firstDepthBin = container.querySelector(
      ".distribution-chart .histogram-hit-area",
    );
    firstDepthBin.dispatchEvent(new PointerEvent("pointerenter"));
    const tooltip = container.querySelector(".distribution-chart .histogram-tooltip");
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("All dives:");
    expect(tooltip.textContent).toContain("Selected dives:");
    firstDepthBin.dispatchEvent(new MouseEvent("click"));
    expect(selectedBins.at(-1)).toEqual([]);
    const populatedDepthBin = [...container.querySelectorAll(".distribution-chart .histogram-hit-area")]
      .find((bin) => bin.getAttribute("aria-label").includes("All dives: 1"));
    populatedDepthBin.dispatchEvent(new MouseEvent("click"));
    expect(selectedBins.at(-1)).toHaveLength(1);
    expect(populatedDepthBin.getAttribute("role")).toBe("button");
    firstDepthBin.dispatchEvent(new PointerEvent("pointerleave"));
    expect(tooltip.hidden).toBe(true);
  });

  it("renders library statistics before any dives are selected", () => {
    const container = document.createElement("div");
    const libraryDives = [
      {
        number: 1,
        dateTime: "2025-01-01T10:00:00Z",
        decoDive: true,
        maxDepth: 30,
        durationSeconds: 3600,
        minTemperature: 18,
        maxCns: 12,
        maxGf99: 70,
      },
      {
        number: 2,
        dateTime: "2025-02-01T10:00:00Z",
        decoDive: false,
        maxDepth: 20,
        durationSeconds: 2400,
        minTemperature: 20,
        maxCns: 5,
        maxGf99: 55,
      },
    ];

    renderSelectionStatistics(container, [], { libraryDives });

    expect(container.querySelectorAll(".selection-grid > section")).toHaveLength(8);
    expect(container.querySelector(".donut-total").textContent).toBe("2");
    expect(container.querySelectorAll(".donut-selection-segment")).toHaveLength(0);
    expect(container.querySelectorAll(".scatter-point-all")).toHaveLength(2);
    expect(container.querySelectorAll(".scatter-point-selected")).toHaveLength(0);
    expect(
      [...container.querySelectorAll(".histogram-bar-selected")].every(
        (bar) => Number(bar.getAttribute("height")) === 0,
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("Select dives to see statistics");
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
