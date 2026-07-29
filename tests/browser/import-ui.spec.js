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

test("map pins multi-select profiles and map zoom filters the dive list", async ({ page }) => {
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
      'Location,Site,Latitude,Longitude\n"Example Island, Test Region",Blue Wall,0,0\n"Example Island, Test Region",Far Reef,50,50',
    ),
  });
  await expect(page.locator("#mapping-count")).toHaveText("2");
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(2);

  const blueWallMarker = page.locator(".leaflet-marker-icon").nth(1);
  await blueWallMarker.click();
  await expect(page.locator("#dive-detail")).toContainText("2 dives selected");
  await expect(page.locator(".profile-legend li")).toHaveCount(2);
  await expect(page.locator("#profile-chart .profile-line")).toHaveCount(2);
  await blueWallMarker.click();
  await expect(page.locator("#dive-detail")).toContainText("Select one or more dives");
  await page.locator("#view-dive-list button").first().evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.locator("#profile-chart .profile-line")).toHaveCount(0);

  await blueWallMarker.dblclick();
  await expect(page.locator("#view-result-count")).toContainText("2 of 3 dives in map view");
  await expect(page.locator("#view-dive-list button")).toHaveCount(2);
  expect(errors).toEqual([]);
});
