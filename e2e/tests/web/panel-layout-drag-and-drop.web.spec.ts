// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Locator, Page, expect, test } from "@playwright/test";

/**
 * Drags panels with real mouse input (native HTML5 drag and drop in Chromium) and checks the
 * resulting layout. The default layout is 3D on the left, Image above Raw Messages on the right.
 */

type Point = [number, number];

/** The layout as one entry per group: its tabs in order, e.g. "3D|Image". */
async function groups(page: Page): Promise<string[]> {
  return await page
    .locator(".dv-groupview")
    .evaluateAll((els) =>
      els.map((g) => [...g.querySelectorAll(".dv-tab")].map((t) => t.textContent).join("|")),
    );
}

async function drag(
  page: Page,
  source: Point | (() => Promise<Point>),
  to: () => Promise<Point>,
  holdMs = 150,
) {
  // A cold dev server can drop the first drag; every panel drag shows "+ New tab" targets, so
  // retry until they show up.
  await expect(async () => {
    const from = typeof source === "function" ? await source() : source;
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(from[0] + 10, from[1] + 10, { steps: 3 });
    // Drag events need movement after the drag has started.
    await page.mouse.move(from[0] + 30, from[1] + 40, { steps: 3 });
    try {
      await page
        .getByTestId("new-tab-drop-target")
        .first()
        .waitFor({ state: "attached", timeout: 2000 });
    } catch (error) {
      await page.mouse.up();
      // Shows in the CI log what the drag grabbed instead of a drag handle.
      const grabbed = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return `${el?.tagName} ${el?.className} draggable=${el?.closest("[draggable=true]") != undefined}`;
      }, from);
      console.log(`drag did not start at ${from.join(",")}: ${grabbed}`);
      throw error;
    }
  }).toPass({ timeout: 30_000 });
  const [x, y] = await to();
  await page.mouse.move(x, y, { steps: 15 });
  await page.waitForTimeout(holdMs);
  await page.mouse.move(x + 1, y + 1);
  await page.mouse.up();
}

function group(page: Page, tab: string): Locator {
  return page.locator(".dv-groupview").filter({ has: page.locator(".dv-tab", { hasText: tab }) });
}

/** A point in a group, as fractions of its size. */
function inGroup(page: Page, tab: string, fx: number, fy: number) {
  return async (): Promise<Point> => {
    const box = (await group(page, tab).boundingBox())!;
    return [box.x + box.width * fx, box.y + box.height * fy];
  };
}

function centerOf(locator: Locator) {
  return async (): Promise<Point> => {
    const box = (await locator.boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
}

/**
 * A grab point on the toolbar of the panel of `type`. Panels with their own toolbar content drag
 * by the toolbar's controls.
 */
async function toolbarOf(page: Page, type: string): Promise<Point> {
  const panel = page.locator(`[data-testid^="panel-mouseenter-container ${type}!"]`);
  return await panel.getByTestId("mosaic-drag-handle").evaluate(async (handle: HTMLElement) => {
    // Panels are repositioned on the next frame after a layout change.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const el = handle.draggable ? handle : handle.querySelector<HTMLElement>("[draggable=true]")!;
    const box = el.getBoundingClientRect();
    return [box.x + Math.min(20, box.width / 2), box.y + box.height / 2] as Point;
  });
}

async function catalogItem(page: Page, title: string): Promise<Point> {
  await page.getByTestId("AddPanelButton").click();
  return await centerOf(page.getByTestId(`panel-menu-item ${title}`))();
}

test.describe("panel layout drag and drop", { tag: "@smoke" }, () => {
  test.beforeEach(async ({ page }) => {
    // The first test compiles panels on a cold dev server.
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    const dialog = page.getByTestId("DataSourceDialog");
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(async () => await groups(page)).toEqual(["3D", "Image", "Raw Messages"]);
    await expect(page.getByTestId("mosaic-drag-handle")).toHaveCount(3, { timeout: 30_000 });
  });

  async function stackImageOn3D(page: Page) {
    await drag(page, async () => await toolbarOf(page, "Image"), inGroup(page, "3D", 0.5, 0.5));
    await expect.poll(async () => await groups(page)).toEqual(["3D|Image", "Raw Messages"]);
  }

  test("stacks a panel dropped on the middle of another as tabs", async ({ page }) => {
    await stackImageOn3D(page);
  });

  test("splits when a panel is dropped on an edge", async ({ page }) => {
    await drag(page, async () => await toolbarOf(page, "Image"), inGroup(page, "3D", 0.03, 0.5));
    await expect.poll(async () => await groups(page)).toEqual(["Image", "3D", "Raw Messages"]);
    const [image, threeD] = await Promise.all([
      group(page, "Image").boundingBox(),
      group(page, "3D").boundingBox(),
    ]);
    expect(image!.x).toBeLessThan(threeD!.x);
  });

  test("moves a tab out of its group onto an edge", async ({ page }) => {
    await stackImageOn3D(page);
    await drag(
      page,
      await centerOf(page.locator(".dv-tab", { hasText: "Image" }))(),
      inGroup(page, "Raw Messages", 0.97, 0.5),
    );
    await expect.poll(async () => await groups(page)).toEqual(["3D", "Raw Messages", "Image"]);
  });

  test("opens a background tab on hover and drops into its group", async ({ page }) => {
    await stackImageOn3D(page);
    await drag(
      page,
      async () => await toolbarOf(page, "RawMessages"),
      centerOf(page.locator(".dv-tab", { hasText: "3D" })),
      900,
    );
    await expect.poll(async () => await groups(page)).toEqual(["3D|Raw Messages|Image"]);
  });

  test("adds a panel as a new tab on the '+ New tab' target", async ({ page }) => {
    await stackImageOn3D(page);
    await drag(
      page,
      async () => await toolbarOf(page, "RawMessages"),
      centerOf(group(page, "3D").getByTestId("new-tab-drop-target")),
    );
    await expect.poll(async () => await groups(page)).toEqual(["3D|Image|Raw Messages"]);
    await expect(page.getByTestId("new-tab-drop-target")).toHaveCount(0);
  });

  // Uses panel types that are already loaded: a cold dev server can fail to lazy-load new ones.
  test("adds panels dragged from the panel catalog", async ({ page }) => {
    await drag(page, await catalogItem(page, "Raw Messages"), inGroup(page, "3D", 0.5, 0.97));
    await expect
      .poll(async () => await groups(page))
      .toEqual(["3D", "Raw Messages", "Image", "Raw Messages"]);
    await expect(page.getByTestId("panel-menu-item Raw Messages")).toHaveCount(0);

    await drag(page, await catalogItem(page, "Image"), inGroup(page, "3D", 0.5, 0.5));
    await expect
      .poll(async () => await groups(page))
      .toEqual(["3D|Image", "Raw Messages", "Image", "Raw Messages"]);

    await drag(
      page,
      await catalogItem(page, "3D"),
      centerOf(group(page, "3D").getByTestId("new-tab-drop-target")),
    );
    await expect
      .poll(async () => await groups(page))
      .toEqual(["3D|Image|3D", "Raw Messages", "Image", "Raw Messages"]);
  });
});
