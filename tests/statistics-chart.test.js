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
        },
        {
          dateTime: "2025-02-03T10:00:00Z",
          decoDive: false,
          maxDepth: 20,
          durationSeconds: 2400,
          minTemperature: 20,
          maxCns: 5,
        },
        {
          dateTime: "2025-02-10T10:00:00Z",
          decoDive: null,
          maxDepth: null,
          durationSeconds: null,
          minTemperature: null,
          maxCns: null,
        },
      ],
      { from: "2025-01-01", to: "2025-02-28" },
    );

    expect(container.querySelector(".donut-total").textContent).toBe("3");
    expect(container.querySelector(".dive-type-summary svg").getAttribute("aria-label")).toBe(
      "1 decompression, 1 no-decompression, and 1 unknown dives",
    );
    expect(container.querySelectorAll(".donut-segment")).toHaveLength(3);
    expect(container.querySelectorAll(".monthly-bar")).toHaveLength(2);
    expect([...container.querySelectorAll(".distribution-chart h3")].map((item) => item.textContent))
      .toEqual(["Maximum depth", "Duration", "Minimum temperature", "Maximum CNS"]);
    expect(container.querySelectorAll(".distribution-bar").length).toBeGreaterThan(0);
    expect(
      container.querySelector(".distribution-chart svg").getAttribute("aria-label"),
    ).toBe("Maximum depth distribution: 2 of 3 selected dives have data");
  });

  it("shows empty states for selected dives without profile summaries", () => {
    const container = document.createElement("div");
    renderSelectionStatistics(container, [{ dateTime: "2025-01-01", decoDive: null }]);
    expect(container.querySelector(".donut-total").textContent).toBe("1");
    expect(container.querySelectorAll(".distribution-chart > p")).toHaveLength(4);
  });
});
