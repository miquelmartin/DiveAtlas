import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const representative = join(process.cwd(), "tests", "fixtures", "representative.uddf");
const malformed = join(process.cwd(), "tests", "fixtures", "malformed.uddf");
const mappings = join(process.cwd(), "tests", "fixtures", "mappings.csv");

async function openProductionShell(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator("#dive-selection-status")).toHaveText(
    "No dive files selected.",
  );
  await expect(page.locator("#theme-select")).toHaveValue("system");
  await expect(page.locator(".app-brand img")).toHaveJSProperty("complete", true);
  expect(await page.locator(".app-brand img").evaluate((image) => image.naturalWidth)).toBe(192);
  return errors;
}

test("dedicated file pickers show selection, results, and refreshed tables", async ({ page }) => {
  const errors = await openProductionShell(page);

  await page.locator("#dive-files").setInputFiles(representative);
  await expect(page.locator("#dive-selection-status")).toContainText(
    "1 dive file selected: representative.uddf",
  );
  await expect(page.locator("#dive-import-status")).toHaveText("Dive import complete");
  await expect(page.locator("#dive-import-results")).toContainText("1 dive(s) imported");
  await expect(page.locator("#dive-count")).toHaveText("1");
  await expect(page.locator("#dive-table-body")).toContainText("Blue Wall");

  await page.locator("#coordinate-file").setInputFiles(mappings);
  await expect(page.locator("#coordinate-selection-status")).toHaveText(
    "mappings.csv selected",
  );
  await expect(page.locator("#coordinate-import-results")).toContainText(
    "2 mapping(s) imported",
  );
  await expect(page.locator("#mapping-count")).toHaveText("2");
  await expect(page.locator("#mapping-table-body")).toContainText("Blue Wall");
  await expect(page.locator("#mapping-table-body")).toContainText("Spain");
  const dataCardHeadings = await page.locator("#data-workspace > .card h3").allTextContents();
  expect(dataCardHeadings.indexOf("Known locations")).toBeLessThan(
    dataCardHeadings.indexOf("Imported dives"),
  );

  await page.locator("#dive-files").setInputFiles(malformed);
  await expect(page.locator("#dive-import-results")).toContainText("malformed XML");
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  await page.locator("#theme-select").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("diveatlas-theme"))).toBe("dark");
  await page.reload();
  await expect(page.locator("#theme-select")).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#view-workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "View" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  await page.locator("#theme-select").selectOption("system");
  expect(await page.evaluate(() => localStorage.getItem("diveatlas-theme"))).toBeNull();
  expect(errors).toEqual([]);
});

test("dropping a UDDF updates selection and imports through the real UI", async ({ page }) => {
  const errors = await openProductionShell(page);
  const text = await readFile(representative, "utf8");
  await page.evaluate((contents) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([contents], "dropped-dive.uddf", { type: "application/xml" }),
    );
    document.querySelector("#dive-drop-zone").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, text);

  await expect(page.locator("#dive-selection-status")).toContainText(
    "1 dive file selected: dropped-dive.uddf",
  );
  await expect(page.locator("#dive-import-results")).toContainText("1 dive(s) imported");
  await expect(page.locator("#dive-count")).toHaveText("1");
  await expect(page.locator("#dive-table-body")).toContainText("Blue Wall");
  expect(errors).toEqual([]);
});

test("coincident dive clusters spiderfy for individual selection", async ({ page }) => {
  const errors = await openProductionShell(page);
  const template = await readFile(representative, "utf8");
  const dives = Array.from({ length: 10 }, (_, index) => {
    const number = 100 + index;
    const day = String(index + 1).padStart(2, "0");
    const contents = template
      .replace('id="synthetic-dive-42"', `id="coincident-${number}"`)
      .replace("<divenumber>42</divenumber>", `<divenumber>${number}</divenumber>`)
      .replace(
        "<datetime>2025-06-15T09:30:00Z</datetime>",
        `<datetime>2025-06-${day}T09:30:00Z</datetime>`,
      );
    return {
      name: `coincident-${number}.uddf`,
      mimeType: "application/xml",
      buffer: Buffer.from(contents),
    };
  });
  await page.locator("#dive-files").setInputFiles(dives);
  await expect(page.locator("#dive-count")).toHaveText("10");
  await page.locator("#coordinate-file").setInputFiles({
    name: "coincident-map.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Location,Site,Latitude,Longitude\n"Example Island, Test Region",Blue Wall,51.456,-0.556',
    ),
  });
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.locator(".marker-cluster")).toHaveCount(1);
  const coincidentCluster = page.getByRole("button", { name: "10", exact: true });
  await expect(coincidentCluster).toBeVisible();
  await coincidentCluster.click();
  await expect(page.locator(".leaflet-marker-icon.dive-map-marker")).toHaveCount(10);
  await expect(page.locator(".dive-spider-leg")).toHaveCount(10);
  const spiderLegStyles = await page.locator(".dive-spider-leg").evaluateAll((legs) => {
    const colorProbe = document.createElement("span");
    colorProbe.style.color = "var(--cp-warning)";
    document.body.append(colorProbe);
    const warning = getComputedStyle(colorProbe).color;
    colorProbe.remove();
    return legs.map((leg) => ({
      stroke: getComputedStyle(leg).stroke,
      warning,
      opacity: getComputedStyle(leg).strokeOpacity,
      width: getComputedStyle(leg).strokeWidth,
    }));
  });
  expect(spiderLegStyles).toEqual(
    Array.from({ length: 10 }, () => ({
      stroke: spiderLegStyles[0].warning,
      warning: spiderLegStyles[0].warning,
      opacity: "1",
      width: "3px",
    })),
  );
  const dive100Marker = page.locator("#map .leaflet-marker-icon[aria-label='Dive 100']");
  await expect(dive100Marker).toBeVisible();
  await expect(dive100Marker).not.toHaveAttribute("title");
  await dive100Marker.hover();
  const tooltip = page.getByRole("tooltip", { name: /^Dive 100\b/ });
  for (const value of [
    "Dive 100",
    "Date",
    "2025-06-01",
    "Location",
    "Example Island, Test Region",
    "Site",
    "Blue Wall",
    "Maximum depth",
    "24.2 m",
    "Duration",
    "3 min",
  ]) {
    await expect(tooltip).toContainText(value);
  }
  const tooltipPointer = await tooltip.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    pointer: getComputedStyle(element, "::before").borderTopColor,
    seamCover: getComputedStyle(element, "::after").backgroundColor,
    wraps: getComputedStyle(element).whiteSpace === "normal",
    contentFits: element.scrollWidth <= element.clientWidth,
  }));
  expect(tooltipPointer.pointer).toBe(tooltipPointer.background);
  expect(tooltipPointer.seamCover).toBe(tooltipPointer.background);
  expect(tooltipPointer.wraps).toBe(true);
  expect(tooltipPointer.contentFits).toBe(true);
  await dive100Marker.click();
  await expect(tooltip).toBeVisible();
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  await expect(dive100Marker).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("group", { name: "Select dives" }).getByRole("button", { name: "None" }).click();
  await page.locator("#map").click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".marker-cluster")).toHaveCount(1);
  await page.getByRole("button", { name: "10", exact: true }).focus();
  await page.getByRole("button", { name: "10", exact: true }).press("Enter");
  await expect(page.locator(".leaflet-marker-icon.dive-map-marker")).toHaveCount(10);
  expect(errors).toEqual([]);
});

test("dense dashboard clusters dives, filters the map, and compares profiles", async ({ page }) => {
  const errors = await openProductionShell(page);
  const first = await readFile(representative, "utf8");
  const second = first
    .replace('id="synthetic-dive-42"', 'id="second"')
    .replace("<divenumber>42</divenumber>", "<divenumber>43</divenumber>")
    .replace("<datetime>2025-06-15T09:30:00Z</datetime>", "<datetime>2025-06-16T09:30:00Z</datetime>")
    .replace("<nodecotime>3000</nodecotime>", "<nodecotime>0</nodecotime>");
  const far = first
    .replace('id="synthetic-dive-42"', 'id="far"')
    .replace("<divenumber>42</divenumber>", "<divenumber>44</divenumber>")
    .replace("<datetime>2025-06-15T09:30:00Z</datetime>", "<datetime>2025-06-17T09:30:00Z</datetime>")
    .replace("<name>Blue Wall</name>", "<name>Far Reef</name>");
  const profileless = first
    .replace('id="synthetic-dive-42"', 'id="profileless"')
    .replace("<divenumber>42</divenumber>", "<divenumber>45</divenumber>")
    .replace("<datetime>2025-06-15T09:30:00Z</datetime>", "<datetime>2025-06-18T09:30:00Z</datetime>")
    .replace("<name>Blue Wall</name>", "<name>Unmapped Cove</name>")
    .replace(/        <samples>[\s\S]*?        <\/samples>\r?\n/, "");
  await page.locator("#dive-files").setInputFiles([
    { name: "first.uddf", mimeType: "application/xml", buffer: Buffer.from(first) },
    { name: "second.uddf", mimeType: "application/xml", buffer: Buffer.from(second) },
    { name: "far.uddf", mimeType: "application/xml", buffer: Buffer.from(far) },
    {
      name: "profileless.uddf",
      mimeType: "application/xml",
      buffer: Buffer.from(profileless),
    },
  ]);
  await expect(page.locator("#dive-count")).toHaveText("4");

  await page.locator("#coordinate-file").setInputFiles({
    name: "map.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Location,Site,Latitude,Longitude\n"Example Island, Test Region",Blue Wall,48.8566,2.3522\n"Example Island, Test Region",Far Reef,35.6762,139.6503',
    ),
  });
  await expect(page.locator("#mapping-count")).toHaveText("2");
  await expect(page.locator(".mapping-location-row")).toHaveCount(1);
  await expect(page.locator(".mapping-location-count")).toHaveText("2 sites");
  await expect(page.locator(".mapping-site-row")).toHaveCount(2);
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.locator(".marker-cluster")).toHaveCount(1);
  await expect(page.locator(".marker-cluster")).toHaveText("2");
  await page.locator(".marker-cluster").click();
  await expect(page.locator(".leaflet-marker-icon.dive-map-marker")).toHaveCount(3);
  const dive42Marker = page.locator("#map .leaflet-marker-icon[aria-label='Dive 42']");
  await expect(dive42Marker).toBeVisible();
  await dive42Marker.click();
  await expect(dive42Marker).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("group", { name: "Select dives" }).getByRole("button", { name: "None" }).click();
  await page.locator("#map").click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".marker-cluster")).toHaveCount(1);
  await expect(page.locator(".leaflet-marker-icon:not(.marker-cluster)")).toHaveCount(1);
  await expect(page.locator(".dive-map-marker")).toHaveCount(1);
  await expect(page.locator(".dive-map-marker")).toHaveText("");
  await expect(page.locator('.leaflet-tile[src*="server.arcgisonline.com"]').first()).toBeAttached();
  await expect(page.locator(".dive-row")).toHaveCount(3);
  await expect(page.locator("#view-dive-list")).not.toContainText("Unmapped Cove");
  await expect(page.locator(".country-group")).toHaveCount(0);
  await expect(page.locator("#min-depth")).toHaveValue("0");
  await expect(page.locator("#min-duration")).toHaveValue("0");
  await expect(page.locator(".dive-list-header button")).toHaveText([
    "# ↓",
    "Site",
    "Location",
    "Country",
  ]);
  await expect(page.locator(".dive-row").first().locator(".dive-cell")).toHaveText([
    "44",
    "Far Reef",
    "Example Island, Test Region",
    "Japan",
  ]);
  await expect(page.locator(".dive-row").first().locator(".dive-stats")).toHaveText(
    "2025-06-17 · 24.2 m · 3 min",
  );
  await expect(page.locator("#view-dive-list")).not.toContainText("UNKNOWN");
  const showOutsideMap = page.getByRole("checkbox", { name: "Show dives outside the map" });
  const selectionActions = page.getByRole("group", { name: "Select dives" });
  const resetFilters = page.getByRole("button", { name: "Reset filters" });
  await expect(resetFilters).toHaveText("×");
  const selectionButtonHeight = await selectionActions.getByRole("button", { name: "Map" }).evaluate(
    (button) => button.getBoundingClientRect().height,
  );
  const resetButtonWidth = await resetFilters.evaluate((button) => button.getBoundingClientRect().width);
  expect(selectionButtonHeight).toBeLessThan(24);
  expect(resetButtonWidth).toBeLessThan(32);
  await expect(page.locator(".dive-list-pane #show-outside-map")).toHaveCount(1);
  await expect(showOutsideMap).toBeEnabled();
  await showOutsideMap.check();
  await expect(page.locator(".dive-row")).toHaveCount(4);
  await page.getByRole("button", { name: /Dive 45,/ }).click();
  await expect(page.locator("#profile-chart")).toContainText(
    "No profile samples are available for the selected dive.",
  );
  await expect(page.locator("#profile-chart .profile-empty")).toHaveCSS("place-items", "center");
  await expect(page.locator("#dive-detail")).toContainText("Unmapped Cove");
  await selectionActions.getByRole("button", { name: "None" }).click();
  await showOutsideMap.uncheck();
  await expect(page.locator("#selection-empty")).toHaveText(
    "Select a dive from the list or map.",
  );
  await expect(page.locator("#selection-empty")).toBeVisible();
  await expect(
    page.locator(
      "#profile-chart:not([hidden]), #selection-stats:not([hidden]), #dive-detail:not([hidden])",
    ),
  ).toHaveCount(0);

  await selectionActions.getByRole("button", { name: "All" }).click();
  await expect(page.locator(".dive-row.is-selected")).toHaveCount(3);
  await expect(page.locator(".marker-cluster.all-selected-dives")).toHaveCount(1);
  await expect(page.locator(".dive-map-marker.is-selected")).toHaveCount(1);
  const selectionColor = await page.locator(".dive-map-marker.is-selected").evaluate((marker) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--cp-selection)";
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return {
      selected: getComputedStyle(marker).backgroundColor,
      expected,
    };
  });
  expect(selectionColor.selected).toBe(selectionColor.expected);
  await expect(page.locator("#dive-detail")).toContainText("3 dives selected");
  await expect(page.locator(".monthly-histogram .histogram-bar-all")).toHaveCount(1);
  await expect(page.locator(".monthly-histogram .histogram-bar-selected")).toHaveCount(1);
  await expect(page.locator(".donut-total")).toHaveText("3");
  await expect(page.locator(".dive-type-summary svg")).toHaveAttribute(
    "aria-label",
    "3 decompression, 0 no-decompression, and 0 unknown dives",
  );
  await expect(page.getByRole("heading", { name: "Decompression Dives" })).toBeVisible();
  await expect(page.locator(".donut-legend")).not.toContainText("Unknown");
  await expect(page.locator(".donut-segment title")).toContainText([
    "3 decompression dives",
  ]);
  await expect(page.locator(".distribution-chart")).toHaveCount(5);
  await expect(page.locator(".distribution-chart .histogram-bar-all")).toHaveCount(100);
  await expect(page.locator(".distribution-chart .histogram-bar-selected")).toHaveCount(100);
  await expect(page.locator(".histogram-chart")).toHaveCount(6);
  await expect(page.locator(".histogram-legend")).toContainText("All dives");
  await expect(page.locator(".histogram-legend")).toContainText("Selected dives");
  await expect(page.getByRole("heading", { name: "Maximum GF99" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Depth Profile" })).toBeVisible();
  const statisticsLayout = await page.locator("#selection-stats").evaluate((container) => {
    const background = getComputedStyle(container).backgroundColor;
    const profileBackground = getComputedStyle(
      document.querySelector("#profile-chart > svg"),
    ).backgroundColor;
    const distribution = container.querySelector(".distribution-chart");
    const monthly = container.querySelector(".monthly-histogram").getBoundingClientRect();
    const diveTypes = container.querySelector(".dive-type-summary").getBoundingClientRect();
    const legend = container.querySelector(".donut-legend");
    return {
      background,
      profileBackground,
      distributionBackground: getComputedStyle(distribution).backgroundColor,
      overviewColumnsAligned: Math.abs(diveTypes.width - monthly.width) < 2,
      legendFits: legend.scrollWidth <= legend.clientWidth,
      chartCount: container.querySelectorAll(".selection-grid > section").length,
      histogramWidthRatio: (() => {
        const svg = distribution.querySelector("svg");
        const bars = [...svg.querySelectorAll(".histogram-bar-all")];
        const first = Number(bars[0].getAttribute("x"));
        const last = bars.at(-1);
        return (Number(last.getAttribute("x")) + Number(last.getAttribute("width")) - first) / 480;
      })(),
      sharedViewBoxes: [...container.querySelectorAll(".histogram-chart svg")].every(
        (svg) => svg.getAttribute("viewBox") === "0 0 480 110",
      ),
      borderlessCharts: [
        document.querySelector("#profile-chart > svg"),
        ...container.querySelectorAll(".selection-grid > section"),
      ].every((element) => getComputedStyle(element).borderTopWidth === "0px"),
      unifiedStatisticsPanel: getComputedStyle(container).borderTopWidth === "0px",
    };
  });
  expect(statisticsLayout.distributionBackground).toBe(statisticsLayout.background);
  expect(statisticsLayout.profileBackground).toBe(statisticsLayout.background);
  expect(statisticsLayout.overviewColumnsAligned).toBe(true);
  expect(statisticsLayout.legendFits).toBe(true);
  expect(statisticsLayout.chartCount).toBe(7);
  expect(statisticsLayout.histogramWidthRatio).toBeGreaterThan(0.95);
  expect(statisticsLayout.sharedViewBoxes).toBe(true);
  expect(statisticsLayout.borderlessCharts).toBe(true);
  expect(statisticsLayout.unifiedStatisticsPanel).toBe(true);
  const histogramColors = await page.locator(".histogram-chart").first().evaluate((chart) => {
    const allBar = chart.querySelector(".histogram-bar-all");
    const selectedBar = chart.querySelector(".histogram-bar-selected");
    const allProbe = document.createElement("span");
    const selectedProbe = document.createElement("span");
    allProbe.style.color = "var(--cp-accent)";
    selectedProbe.style.color = "var(--cp-selection)";
    document.body.append(allProbe, selectedProbe);
    const colors = {
      all: getComputedStyle(allBar).fill,
      expectedAll: getComputedStyle(allProbe).color,
      selected: getComputedStyle(selectedBar).fill,
      expectedSelected: getComputedStyle(selectedProbe).color,
    };
    allProbe.remove();
    selectedProbe.remove();
    return colors;
  });
  expect(histogramColors.all).toBe(histogramColors.expectedAll);
  expect(histogramColors.selected).toBe(histogramColors.expectedSelected);
  const firstMonthlyBin = page.locator(".monthly-histogram .histogram-hit-area").first();
  await firstMonthlyBin.hover();
  await expect(page.locator(".monthly-histogram .histogram-tooltip")).toContainText("All dives:");
  await expect(page.locator(".monthly-histogram .histogram-tooltip")).toContainText(
    "Selected dives:",
  );
  await expect(page.locator(".monthly-histogram .histogram-tooltip")).toHaveCSS(
    "white-space",
    "normal",
  );
  for (const chart of await page.locator(".histogram-chart").all()) {
    await expect(chart.locator(".histogram-hit-area").first()).toHaveAttribute(
      "aria-label",
      /All dives: \d+ · Selected dives: \d+/,
    );
  }
  const percentageAxisMaximums = await page
    .locator(".distribution-chart")
    .filter({ has: page.getByRole("heading", { name: /Maximum (CNS|GF99)/ }) })
    .locator(".selection-axis-label:last-of-type")
    .allTextContents();
  expect(percentageAxisMaximums).toHaveLength(2);
  expect(percentageAxisMaximums.every((label) => Number.parseFloat(label) >= 100)).toBe(true);
  const donutColors = await page.locator(".donut-key").evaluateAll((keys) =>
    keys.map((key) => ({
      legend: getComputedStyle(key).backgroundColor,
      segment: getComputedStyle(
        document.querySelector(`.donut-segment.${[...key.classList].find((name) =>
          name.startsWith("donut-") && name !== "donut-key",
        )}`),
      ).stroke,
    })),
  );
  expect(donutColors.every(({ legend, segment }) => legend === segment)).toBe(true);
  await expect(page.locator(".profile-legend")).toHaveCount(0);
  await selectionActions.getByRole("button", { name: "None" }).click();
  await expect(page.locator(".dive-row.is-selected")).toHaveCount(0);
  await expect(page.locator(".marker-cluster.has-selected-dives")).toHaveCount(0);
  await expect(page.locator(".dive-map-marker.is-selected")).toHaveCount(0);
  await expect(selectionActions.getByRole("button", { name: "None" })).toBeDisabled();
  await page.getByRole("button", { name: /Dive 42,/ }).click();
  await expect(page.locator(".marker-cluster.has-selected-dives")).toHaveCount(1);
  await expect(page.locator(".marker-cluster.all-selected-dives")).toHaveCount(0);
  await selectionActions.getByRole("button", { name: "None" }).click();
  await selectionActions.getByRole("button", { name: "Map" }).click();
  await expect(page.locator(".dive-row.is-selected")).toHaveCount(3);
  await selectionActions.getByRole("button", { name: "None" }).click();
  const [mapBounds, markerBounds] = await Promise.all([
    page.locator("#map").boundingBox(),
    page.locator(".dive-map-marker").boundingBox(),
  ]);
  await page.locator(".leaflet-marker-icon").evaluateAll((markers) => {
    markers.forEach((marker) => {
      marker.style.pointerEvents = "none";
    });
  });
  await page.locator("#map").dblclick({
    position: {
      x: markerBounds.x - mapBounds.x + markerBounds.width / 2,
      y: markerBounds.y - mapBounds.y + markerBounds.height / 2,
    },
  });
  await expect
    .poll(() => page.locator(".dive-row.is-selected").count())
    .toBeGreaterThan(0);
  await page.locator("#clear-filters").click();
  while ((await page.locator(".dive-row.is-selected").count()) > 0) {
    await page.locator(".dive-row.is-selected").first().click();
  }

  await page.locator(".leaflet-control-layers-toggle").hover({ force: true });
  await expect(page.getByText("Satellite", { exact: true })).toBeVisible();
  await expect(page.getByText("Street map", { exact: true })).toBeVisible();
  await page.getByText("Seamarks", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Seamarks" })).toBeChecked();

  const farMarker = page.locator(".leaflet-marker-icon:not(.marker-cluster)");
  await farMarker.click();
  await expect(page.locator("#profile-chart .profile-line")).toHaveCount(1);
  await page.getByRole("button", { name: /Dive 42,/ }).click();
  await expect(page.locator("#dive-detail")).toContainText("2 dives selected");
  await expect(page.locator("#profile-chart .profile-line")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Depth Profile" })).toBeVisible();
  await expect(page.locator(".profile-axis-label")).toHaveCount(10);
  await page.locator("#profile-chart svg").hover({ position: { x: 200, y: 100 } });
  await expect(page.locator(".chart-tooltip > span")).toHaveCount(1);
  await expect(page.locator(".chart-tooltip")).toContainText(
    "Dive 44 · Example Island, Test Region · Far Reef",
  );
  await expect(page.locator(".chart-tooltip")).toContainText("m ·");
  await expect(page.locator(".chart-tooltip")).toContainText("min");
  await expect(page.locator(".profile-line").first()).toHaveCSS("stroke-width", "1.25px");
  await expect(page.locator(".profile-hover-point")).toBeVisible();

  const [mapBox, chartBox] = await Promise.all([
    page.locator("#map").boundingBox(),
    page.locator("#profile-chart").boundingBox(),
  ]);
  expect(Math.max(mapBox.y, chartBox.y)).toBeLessThan(
    Math.min(mapBox.y + mapBox.height, chartBox.y + chartBox.height),
  );

  await farMarker.dblclick();
  await expect(page.locator("#view-result-count")).toContainText("of 4 dives in map view");
  const visibleDiveCount = await page.locator(".dive-row").count();
  expect(visibleDiveCount).toBeLessThan(3);
  await showOutsideMap.check();
  await expect(page.locator(".dive-row")).toHaveCount(4);
  await expect(page.locator(".dive-row.is-outside-map")).toHaveCount(4 - visibleDiveCount);
  await expect(showOutsideMap).toBeChecked();
  await expect(page.getByRole("button", { name: "Show all map" })).toHaveCount(0);
  await page.locator("#clear-filters").click();
  await expect(page.locator("#view-result-count")).toHaveText("3 of 4 mapped dives");
  await expect(showOutsideMap).toBeEnabled();

  await page.locator("#date-range-end").evaluate((input) => {
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#view-result-count")).toHaveText("2 dives");
  await expect(page.locator(".dive-row")).toHaveCount(2);
  await expect(page.locator("#date-range-label")).toContainText("2025-06-16");
  await expect(page.locator("#date-range-track")).toHaveCSS("--range-start", "0%");
  await expect(page.locator("#date-range-track")).toHaveCSS(
    "--range-end",
    "33.33333333333333%",
  );
  await page.locator("#date-range-start").evaluate((input) => {
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#date-range-track")).toHaveCSS(
    "--range-start",
    "33.33333333333333%",
  );
  await expect(page.locator("#date-range-track")).toHaveCSS(
    "--range-end",
    "33.33333333333333%",
  );

  await page.locator("#min-depth").fill("25");
  await expect(page.locator("#view-result-count")).toHaveText("0 dives");
  await page.locator("#clear-filters").click();
  await expect(page.locator("#view-result-count")).toHaveText("3 of 4 mapped dives");
  await expect(page.locator("#min-depth")).toHaveValue("0");
  await expect(page.locator("#min-duration")).toHaveValue("0");

  await page.locator('[data-sort="country"]').click();
  await expect(page.locator('[data-sort="country"]')).toHaveAttribute("data-direction", "asc");
  await expect(page.locator(".dive-country")).toHaveText(["France", "France", "Japan"]);
  const chartBoxAfterSort = await page.locator("#profile-chart").boundingBox();
  const detailBox = await page.locator("#dive-detail").boundingBox();
  expect(chartBoxAfterSort.y).toBeLessThan(detailBox.y);
  expect(await page.locator(".tagline").count()).toBe(0);
  expect(errors).toEqual([]);
});
