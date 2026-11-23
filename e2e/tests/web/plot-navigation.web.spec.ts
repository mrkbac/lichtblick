// SPDX-License-Identifier: MPL-2.0

import { expect, Page, test } from "@playwright/test";

import { loadFiles } from "../../fixtures/load-files";
import { LayoutManager, PlayerControls, Sidebar } from "../../page-objects";

async function verifyPlotNavigation(page: Page): Promise<void> {
  await loadFiles({ mainWindow: page, filenames: "example-2.mcap" });
  const player = new PlayerControls(page);
  await expect(player.getPlayButton()).toBeEnabled();

  await new Sidebar(page).openLayoutsTab();
  const layout = new LayoutManager(page);
  await layout.getCreateNewLayoutButton().click();
  await layout.selectPanel("Plot");
  await page.getByTestId("add-series").click();
  const seriesInput = page.getByPlaceholder("Field, or a message to add all its fields");
  await seriesInput.fill("mouse.clientX");
  await seriesInput.press("Enter");
  await expect(page.getByTestId("plot-legend-row-path-label")).toHaveText("mouse.clientX");

  const canvas = page.getByTestId("vertical-bar-wrapper").locator("canvas");
  const marker = page.getByTestId("vertical-bar");
  const reset = page.getByTestId("plot-reset-view-button");
  await expect(marker).toBeVisible();
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Plot canvas is not rendered");
  }

  const markerX = async () => await marker.evaluate((element) => element.getBoundingClientRect().x);
  const y = bounds.y + bounds.height * 0.55;
  const seekX = bounds.x + bounds.width * 0.65;
  const anchorX = bounds.x + bounds.width * 0.35;
  await page.mouse.click(seekX, y);
  await expect.poll(async () => Math.abs((await markerX()) - seekX)).toBeLessThan(5);
  const soughtTime = await player.getTimestampText();

  await page.mouse.move(anchorX, y);
  await page.mouse.wheel(0, -120);
  await expect(reset).toBeVisible();
  await expect.poll(markerX).toBeGreaterThan(seekX + 5);
  const zoomedX = await markerX();

  await page.mouse.down();
  await page.mouse.move(anchorX - bounds.width * 0.15, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(markerX).toBeLessThan(zoomedX - 10);
  await expect(player.getTimestampInput()).toHaveValue(soughtTime);

  await reset.click();
  await expect(reset).toBeHidden();
  await expect.poll(async () => Math.abs((await markerX()) - seekX)).toBeLessThan(5);
}

test("seeks, zooms, pans, and resets a Plot", { tag: "@regression" }, async ({ page }) => {
  await page.goto("/");
  await verifyPlotNavigation(page);
});
