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
  await expect(page.getByRole("button", { name: "Auto" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
    "2 mapping(s) added",
  );
  await expect(page.locator("#mapping-count")).toHaveText("2");
  await expect(page.locator("#mapping-table-body")).toContainText("Blue Wall");
  await expect(page.locator("#mapping-table-body")).toContainText("Spain");
  const dataCardHeadings = await page.locator(".data-table-grid > .card h3").allTextContents();
  expect(dataCardHeadings.indexOf("Known locations")).toBeLessThan(
    dataCardHeadings.indexOf("Imported dives"),
  );
  const tableCards = await page.locator(".data-table-grid > .card").evaluateAll((cards) =>
    cards.map((card) => card.getBoundingClientRect().top),
  );
  expect(Math.abs(tableCards[0] - tableCards[1])).toBeLessThan(2);
  await page.locator("#coordinate-file").setInputFiles({
    name: "updated-mappings.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Location,Site,Latitude,Longitude\n"Example Island, Test Region",Blue Wall,1.23456,2.34567\n',
    ),
  });
  await expect(page.locator("#coordinate-import-results")).toContainText(
    "1 existing mapping(s) updated",
  );
  await expect(page.locator("#mapping-table-body")).toContainText("1.23456");

  await page.locator("#dive-files").setInputFiles(malformed);
  await expect(page.locator("#dive-import-results")).toContainText("malformed XML");
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("diveatlas-theme"))).toBe("dark");
  await page.reload();
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#view-workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "View" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  await page.getByRole("button", { name: "Auto" }).click();
  expect(await page.evaluate(() => localStorage.getItem("diveatlas-theme"))).toBeNull();
  await page.getByRole("button", { name: "Data" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear all data" }).click();
  await expect(page.locator("#data-workspace")).toBeVisible();
  await expect(page.locator("#dive-count")).toHaveText("0");
  await expect(page.locator("#mapping-count")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("mobile file selection imports and the three view panels stack", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openProductionShell(page);
  const pickerGeometry = await page.locator("#dive-drop-zone").evaluate((zone) => {
    const input = zone.querySelector("input");
    const zoneBox = zone.getBoundingClientRect();
    const inputBox = input.getBoundingClientRect();
    return {
      widthDifference: Math.abs(zoneBox.width - inputBox.width),
      heightDifference: Math.abs(zoneBox.height - inputBox.height),
    };
  });
  expect(pickerGeometry.widthDifference).toBeLessThanOrEqual(2);
  expect(pickerGeometry.heightDifference).toBeLessThanOrEqual(2);

  await page.locator("#dive-files").setInputFiles(representative);
  await expect(page.locator("#dive-import-results")).toContainText("1 dive(s) imported");
  await page.locator("#coordinate-file").setInputFiles(mappings);
  await expect(page.locator("#coordinate-import-results")).toContainText("2 mapping(s) added");
  const dataColumns = await page.locator(".data-table-grid").evaluate(
    (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length,
  );
  expect(dataColumns).toBe(1);

  await page.getByRole("button", { name: "View" }).click();
  const panels = await page.locator(".view-dashboard > .dashboard-pane").evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect()).map(({ top, left, right }) => ({
      top,
      left,
      right,
    })),
  );
  expect(panels[0].top).toBeLessThan(panels[1].top);
  expect(panels[1].top).toBeLessThan(panels[2].top);
  expect(panels.every((panel) => panel.left >= 0 && panel.right <= 390)).toBe(true);
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
  test.setTimeout(180_000);
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
  await expect(page.locator(".mapping-site-row:visible")).toHaveCount(0);
  const locationToggle = page.getByRole("button", {
    name: "Example Island, Test Region 2 sites",
  });
  await expect(locationToggle).toHaveAttribute("aria-expanded", "false");
  await locationToggle.click();
  await expect(locationToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".mapping-site-row:visible")).toHaveCount(2);
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
  const resetFilters = page.getByRole("button", { name: "Clear filters" });
  await expect(page.locator(".dive-control-section legend")).toHaveText(["Filters", "Select"]);
  await expect(resetFilters).toContainText("Clear filters");
  const selectionButtonHeight = await selectionActions.getByRole("button", { name: "Map" }).evaluate(
    (button) => button.getBoundingClientRect().height,
  );
  const resetPosition = await resetFilters.evaluate((button) => {
    const buttonBox = button.getBoundingClientRect();
    const filterBox = button.closest("fieldset").getBoundingClientRect();
    const firstInput = button.closest("fieldset").querySelector("input").getBoundingClientRect();
    return {
      nearTop: buttonBox.top < firstInput.top,
      nearRight: filterBox.right - buttonBox.right < 10,
    };
  });
  expect(selectionButtonHeight).toBeLessThan(24);
  expect(resetPosition).toEqual({ nearTop: true, nearRight: true });
  await expect(page.locator(".dive-filter-controls #show-outside-map")).toHaveCount(1);
  await expect(page.locator(".dive-control-section:first-child #show-outside-map")).toHaveCount(1);
  const filterLayout = await page.locator(".dive-filter-controls").evaluate((filters) => {
    const keyword = filters.querySelector(".view-keyword input");
    const thresholdLabels = [...filters.querySelectorAll(".view-thresholds label")];
    return {
      keywordBorderTop: getComputedStyle(keyword).borderTopWidth,
      keywordBorderBottom: getComputedStyle(keyword).borderBottomWidth,
      thresholdsInline: thresholdLabels.every((label) => {
        const input = label.querySelector("input").getBoundingClientRect();
        const bounds = label.getBoundingClientRect();
        return Math.abs(input.y + input.height / 2 - (bounds.y + bounds.height / 2)) < 2;
      }),
    };
  });
  expect(filterLayout).toEqual({
    keywordBorderTop: "0px",
    keywordBorderBottom: "1px",
    thresholdsInline: true,
  });
  await expect(showOutsideMap).toBeEnabled();
  await showOutsideMap.check();
  await expect(page.locator(".dive-row")).toHaveCount(4);
  await page.getByRole("button", { name: /Dive 45,/ }).click();
  await expect(page.locator("#profile-chart")).toContainText(
    "No profile samples are available for the selected dive.",
  );
  await expect(page.locator("#profile-chart .profile-empty")).toHaveCSS("place-items", "center");
  await expect(page.locator("#dive-detail")).toContainText("Unmapped Cove");
  await expect(page.locator("#dive-detail")).toContainText("No-decompression");
  await selectionActions.getByRole("button", { name: "None" }).click();
  await showOutsideMap.uncheck();
  await expect(page.locator("#selection-empty")).toHaveText(
    "Select a dive from the list or map.",
  );
  await expect(page.locator("#selection-empty")).toBeVisible();
  await expect(page.locator("#profile-chart:not([hidden]), #dive-detail:not([hidden])")).toHaveCount(
    0,
  );
  await expect(page.locator("#selection-stats")).toBeVisible();
  await expect(page.locator("#selection-stats > section")).toHaveCount(8);
  await expect(page.locator(".scatter-point-all")).toHaveCount(3);
  await expect(page.locator(".scatter-point-selected")).toHaveCount(0);
  await expect(page.locator(".donut-selection-segment")).toHaveCount(0);
  await expect(page.locator(".donut-total")).toHaveText("4");
  await expect(page.locator(".dive-type-summary svg")).toHaveAttribute(
    "aria-label",
    "3 decompression, 1 no-decompression, and 0 unknown dives in the library; 0 selected",
  );
  expect(
    await page.locator(".histogram-bar-selected").evaluateAll((bars) =>
      bars.every((bar) => Number(bar.getAttribute("height")) === 0),
    ),
  ).toBe(true);

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
  await expect(page.locator(".donut-total")).toHaveText("4");
  await expect(page.locator(".dive-type-summary svg")).toHaveAttribute(
    "aria-label",
    "3 decompression, 1 no-decompression, and 0 unknown dives in the library; 3 selected",
  );
  await expect(page.getByRole("heading", { name: "Decompression Dives" })).toBeVisible();
  await expect(page.locator(".donut-legend")).not.toContainText("Unknown");
  await expect(page.locator(".donut-segment title")).toContainText([
    "Decompression · All dives: 3 · Selected dives: 3",
    "No-decompression · All dives: 1 · Selected dives: 0",
  ]);
  await expect(page.locator(".donut-selection-segment")).toHaveCount(1);
  await expect(page.locator(".distribution-chart")).toHaveCount(5);
  await expect(page.locator(".distribution-chart .histogram-bar-all")).toHaveCount(100);
  await expect(page.locator(".distribution-chart .histogram-bar-selected")).toHaveCount(100);
  await expect(page.locator(".histogram-chart")).toHaveCount(6);
  await expect(page.locator(".histogram-legend")).toContainText("All dives");
  await expect(page.locator(".histogram-legend")).toContainText("Selected dives");
  await expect(page.getByRole("heading", { name: "Maximum GF99" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Depth Profile" })).toBeVisible();
  const statisticsLayout = await page.locator("#selection-stats").evaluate((container) => {
    const plotGrid = container.closest(".plots-grid");
    const background = getComputedStyle(plotGrid).backgroundColor;
    const profileBackground = getComputedStyle(
      document.querySelector("#profile-chart > svg"),
    ).backgroundColor;
    const distribution = container.querySelector(".distribution-chart");
    const monthly = container.querySelector(".monthly-histogram").getBoundingClientRect();
    const diveTypes = container.querySelector(".dive-type-summary").getBoundingClientRect();
    const legend = container.querySelector(".donut-legend");
    const profileChart = document.querySelector("#profile-chart");
    const profileSvg = profileChart.querySelector("svg").getBoundingClientRect();
    const profileStyle = getComputedStyle(profileChart);
    const profileRect = profileChart.getBoundingClientRect();
    const detailRect = document.querySelector("#dive-detail").getBoundingClientRect();
    return {
      background,
      profileBackground,
      distributionBackground: getComputedStyle(distribution).backgroundColor,
      overviewColumnsAligned: Math.abs(diveTypes.width - monthly.width) < 2,
      legendFits: legend.scrollWidth <= legend.clientWidth,
      chartCount: container.querySelectorAll(":scope > section").length,
      legendAfterPlots:
        container.querySelector(".histogram-legend") === container.lastElementChild &&
        container.querySelector(".histogram-legend").getBoundingClientRect().right <=
          plotGrid.getBoundingClientRect().right,
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
        ...container.querySelectorAll(":scope > section"),
      ].every((element) => getComputedStyle(element).borderTopWidth === "0px"),
      unifiedStatisticsPanel: getComputedStyle(container).borderTopWidth === "0px",
      equalBarWidths: [...container.querySelectorAll(".histogram-bar-all")].every(
        (allBar, index) => {
          const selectedBar = container.querySelectorAll(".histogram-bar-selected")[index];
          return (
            allBar.getAttribute("x") === selectedBar.getAttribute("x") &&
            allBar.getAttribute("width") === selectedBar.getAttribute("width")
          );
        },
      ),
      histogramHeight: container.querySelector(".histogram-chart svg").getBoundingClientRect().height,
      scatterHeight: container.querySelector(".scatter-chart svg").getBoundingClientRect().height,
      donutHeight: container.querySelector(".dive-type-summary svg").getBoundingClientRect().height,
      plotGap: Number.parseFloat(getComputedStyle(plotGrid).columnGap),
      profileSpansGrid: profileRect.width > monthly.width * 1.8,
      detailsAboveProfile: detailRect.bottom <= profileRect.top,
      profileDoesNotOverlapPlots: profileRect.bottom <= monthly.top,
      profileWidthRatio:
        profileSvg.width /
        (profileChart.clientWidth -
          Number.parseFloat(profileStyle.paddingLeft) -
          Number.parseFloat(profileStyle.paddingRight)),
      profileAspectRatio: profileSvg.width / profileSvg.height,
      profileHeight: document.querySelector("#profile-chart").getBoundingClientRect().height,
      scatterYAxis: [...container.querySelectorAll(".scatter-axis-y-label")].map((label) => ({
        text: label.textContent,
        y: Number(label.getAttribute("y")),
      })),
    };
  });
  expect(statisticsLayout.distributionBackground).toBe(statisticsLayout.background);
  expect(statisticsLayout.profileBackground).toBe(statisticsLayout.background);
  expect(statisticsLayout.overviewColumnsAligned).toBe(true);
  expect(statisticsLayout.legendFits).toBe(true);
  expect(statisticsLayout.chartCount).toBe(8);
  expect(statisticsLayout.legendAfterPlots).toBe(true);
  expect(statisticsLayout.histogramWidthRatio).toBeGreaterThan(0.95);
  expect(statisticsLayout.sharedViewBoxes).toBe(true);
  expect(statisticsLayout.borderlessCharts).toBe(true);
  expect(statisticsLayout.unifiedStatisticsPanel).toBe(true);
  expect(statisticsLayout.equalBarWidths).toBe(true);
  expect(statisticsLayout.histogramHeight).toBeGreaterThan(120);
  expect(statisticsLayout.scatterHeight).toBeGreaterThan(150);
  expect(statisticsLayout.donutHeight).toBeGreaterThan(80);
  expect(statisticsLayout.plotGap).toBeGreaterThanOrEqual(10);
  expect(statisticsLayout.profileSpansGrid).toBe(true);
  expect(statisticsLayout.detailsAboveProfile).toBe(true);
  expect(statisticsLayout.profileDoesNotOverlapPlots).toBe(true);
  expect(statisticsLayout.profileWidthRatio).toBeGreaterThan(0.98);
  expect(statisticsLayout.profileAspectRatio).toBeCloseTo(720 / 280, 1);
  expect(statisticsLayout.profileHeight).toBeLessThan(250);
  expect(statisticsLayout.scatterYAxis).toEqual([
    { text: "24.2 m", y: 119 },
    { text: "0 m", y: 9 },
  ]);
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
  await page
    .locator(".distribution-chart")
    .filter({ has: page.getByRole("heading", { name: "Duration" }) })
    .locator(".histogram-hit-area")
    .filter({ has: page.locator("title", { hasText: "All dives: 4" }) })
    .click();
  await expect(page.locator("#dive-detail")).toContainText("4 dives selected");
  await expect(page.locator(".marker-cluster.all-selected-dives")).toHaveCount(1);
  await expect(page.locator("#plot-selection-control")).toBeVisible();
  await expect(page.locator("#filter-plot-selection")).toBeChecked();
  await page.locator("#filter-plot-selection").uncheck();
  await expect(page.locator(".dive-row")).toHaveCount(3);
  await page.locator(".donut-segment.donut-decompression").click({
    position: { x: 61, y: 32 },
  });
  await expect(page.locator("#dive-detail")).toContainText("3 dives selected");
  await expect(page.locator("#filter-plot-selection")).toBeChecked();
  await page.locator("#filter-plot-selection").uncheck();
  await page.locator(".scatter-hit-area").last().click();
  await expect(page.locator("#filter-plot-selection")).toBeChecked();
  await expect(page.locator("#dive-detail dl")).toBeVisible();
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
  const donutColors = await page.locator(".donut-key").evaluateAll((keys) => {
    const probes = ["--cp-accent", "--cp-selection"].map((variable) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${variable})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    return {
      histogramColors: probes,
      donut: keys.map((key) => ({
        legend: getComputedStyle(key).backgroundColor,
        segment: getComputedStyle(
          document.querySelector(`.donut-segment.${[...key.classList].find((name) =>
            name.startsWith("donut-") && name !== "donut-key",
          )}`),
        ).stroke,
      })),
    };
  });
  expect(donutColors.donut.every(({ legend, segment }) => legend === segment)).toBe(true);
  expect(
    donutColors.donut.every(({ legend }) => !donutColors.histogramColors.includes(legend)),
  ).toBe(true);
  await expect(page.locator(".donut-selection-segment").first()).toHaveCSS(
    "stroke",
    histogramColors.expectedSelected,
  );
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
  expect(detailBox.y).toBeLessThan(chartBoxAfterSort.y);
  expect(await page.locator(".tagline").count()).toBe(0);
  expect(errors).toEqual([]);
});
