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

  await page.locator("#dive-files").setInputFiles(malformed);
  await expect(page.locator("#dive-import-results")).toContainText("malformed XML");
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
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

test("dense dashboard clusters dives, filters the map, and compares profiles", async ({ page }) => {
  const errors = await openProductionShell(page);
  const first = await readFile(representative, "utf8");
  const second = first
    .replace('id="synthetic-dive-42"', 'id="second"')
    .replace("<divenumber>42</divenumber>", "<divenumber>43</divenumber>")
    .replace("<datetime>2025-06-15T09:30:00Z</datetime>", "<datetime>2025-06-16T09:30:00Z</datetime>");
  const far = first
    .replace('id="synthetic-dive-42"', 'id="far"')
    .replace("<divenumber>42</divenumber>", "<divenumber>44</divenumber>")
    .replace("<datetime>2025-06-15T09:30:00Z</datetime>", "<datetime>2025-06-17T09:30:00Z</datetime>")
    .replace("<name>Blue Wall</name>", "<name>Far Reef</name>");
  await page.locator("#dive-files").setInputFiles([
    { name: "first.uddf", mimeType: "application/xml", buffer: Buffer.from(first) },
    { name: "second.uddf", mimeType: "application/xml", buffer: Buffer.from(second) },
    { name: "far.uddf", mimeType: "application/xml", buffer: Buffer.from(far) },
  ]);
  await expect(page.locator("#dive-count")).toHaveText("3");

  await page.locator("#coordinate-file").setInputFiles({
    name: "map.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Location,Site,Latitude,Longitude\n"Example Island, Test Region",Blue Wall,48.8566,2.3522\n"Example Island, Test Region",Far Reef,35.6762,139.6503',
    ),
  });
  await expect(page.locator("#mapping-count")).toHaveText("2");
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.locator(".marker-cluster")).toHaveCount(1);
  await expect(page.locator(".marker-cluster")).toHaveText("2");
  await expect(page.locator(".leaflet-marker-icon:not(.marker-cluster)")).toHaveCount(1);
  await expect(page.locator('.leaflet-tile[src*="server.arcgisonline.com"]').first()).toBeAttached();
  await expect(page.locator(".dive-row")).toHaveCount(3);
  await expect(page.locator(".country-group")).toHaveCount(0);
  await expect(page.locator(".dive-row").first().locator(".dive-stats")).toHaveText(
    "2025-06-17 · Japan · 24.2 m · 3 min",
  );
  await expect(page.locator("#view-dive-list")).not.toContainText("UNKNOWN");

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
  await expect(page.locator(".profile-legend li")).toHaveCount(2);
  await expect(page.locator("#profile-chart .profile-line")).toHaveCount(2);
  await expect(page.locator(".profile-axis-label")).toHaveCount(10);
  await page.locator("#profile-chart svg").hover({ position: { x: 200, y: 100 } });
  await expect(page.locator(".chart-tooltip")).toContainText(
    "Dive 44 · Example Island, Test Region · Far Reef",
  );
  await expect(page.locator(".chart-tooltip")).toContainText("m ·");
  await expect(page.locator(".chart-tooltip")).toContainText("min");

  const [mapBox, chartBox] = await Promise.all([
    page.locator("#map").boundingBox(),
    page.locator("#profile-chart").boundingBox(),
  ]);
  expect(Math.max(mapBox.y, chartBox.y)).toBeLessThan(
    Math.min(mapBox.y + mapBox.height, chartBox.y + chartBox.height),
  );

  await farMarker.dblclick();
  await expect(page.locator("#view-result-count")).toContainText("of 3 dives in map view");
  const visibleDiveCount = await page.locator(".dive-row").count();
  expect(visibleDiveCount).toBeLessThan(3);
  await page.getByRole("button", { name: "Show dives outside the map" }).click();
  await expect(page.locator(".dive-row")).toHaveCount(3);
  await expect(page.locator(".dive-row.is-outside-map")).toHaveCount(3 - visibleDiveCount);
  await expect(page.getByRole("button", { name: "Hide dives outside the map" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#reset-map-filter").click();
  await expect(page.locator("#view-result-count")).toHaveText("3 dives");
  await expect(page.getByRole("button", { name: "Show dives outside the map" })).toBeDisabled();

  await page.locator("#date-range-end").evaluate((input) => {
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#view-result-count")).toHaveText("2 dives");
  await expect(page.locator(".dive-row")).toHaveCount(2);
  await expect(page.locator("#date-range-label")).toContainText("2025-06-16");
  await expect(page.locator("#date-range-track")).toHaveCSS("--range-start", "0%");
  await expect(page.locator("#date-range-track")).toHaveCSS("--range-end", "50%");
  await page.locator("#date-range-start").evaluate((input) => {
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#date-range-track")).toHaveCSS("--range-start", "50%");
  await expect(page.locator("#date-range-track")).toHaveCSS("--range-end", "50%");

  await page.locator("#min-depth").fill("25");
  await expect(page.locator("#view-result-count")).toHaveText("0 dives");
  await page.locator("#clear-filters").click();
  await expect(page.locator("#view-result-count")).toHaveText("3 dives");

  await page.locator('[data-sort="country"]').click();
  await expect(page.locator('[data-sort="country"]')).toHaveAttribute("data-direction", "asc");
  await expect(page.locator(".dive-country")).toHaveText(["France", "France", "Japan"]);
  const chartBoxAfterSort = await page.locator("#profile-chart").boundingBox();
  const detailBox = await page.locator("#dive-detail").boundingBox();
  expect(chartBoxAfterSort.y).toBeLessThan(detailBox.y);
  expect(await page.locator(".tagline").count()).toBe(0);
  expect(errors).toEqual([]);
});
