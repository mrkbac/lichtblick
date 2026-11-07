// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Locator, Page, expect, test } from "@playwright/test";

import { loadFiles } from "../../fixtures/load-files";

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
  /** Waits for a state that must hold before the drop, e.g. a hovered tab opening. */
  beforeDrop?: () => Promise<void>,
) {
  // Every panel drag shows "+ New tab" targets; retry until they show up, in case something
  // covered the drag handle.
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
      // On a cold dev server the data source dialog can open again after the first Escape.
      if (await page.getByTestId("DataSourceDialog").isVisible()) {
        await page.keyboard.press("Escape");
      }
      throw error;
    }
  }).toPass({ timeout: 30_000 });
  const [x, y] = await to();
  await page.mouse.move(x, y, { steps: 15 });
  await beforeDrop?.();
  // The drop goes where the last dragover was.
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

async function selectTab(page: Page, title: string) {
  const tab = page.getByRole("tab", { name: title, exact: true });
  await tab.locator(".dv-default-tab-content").click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
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

  for (const nested of [false, true]) {
    test(`fills panel slots before paint during sidebar resizing${nested ? " inside a Tab panel" : ""}`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      if (nested) {
        await drag(page, await catalogItem(page, "Tab"), inGroup(page, "3D", 0.5, 0.5));
        await expect(page.getByTestId("add-tab")).toBeVisible();
        const tabPanel = page.locator('[data-testid^="panel-mouseenter-container Tab!"]');
        await tabPanel.getByTestId("panel-grid-card Image").click();
        await expect(
          tabPanel.locator('[data-testid^="panel-mouseenter-container Image!"]'),
        ).toBeVisible();
        await expect(page.locator("[data-panel-layout] .dv-dockview")).toHaveCount(2);
      }

      const measurements = await page.evaluateHandle(() => {
        const gaps: number[] = [];
        const observer = new ResizeObserver((entries) => {
          // Measure after the layout's resize observer has sized the panel slots.
          queueMicrotask(() => {
            for (const { target } of entries) {
              if (!(target instanceof HTMLElement) || !target.offsetParent) {
                continue;
              }
              const layout = target.parentElement!;
              const ownElements = (selector: string) =>
                [...target.querySelectorAll<HTMLElement>(selector)].filter(
                  (element) => element.closest("[data-panel-layout]") === layout,
                );
              const grid = ownElements(".dv-dockview").at(0);
              if (grid == undefined) {
                gaps.push(Infinity);
                continue;
              }
              gaps.push(Math.abs(target.clientWidth - grid.clientWidth));
              gaps.push(Math.abs(target.clientHeight - grid.clientHeight));
              for (const slot of ownElements(".dv-content-container")) {
                const box = slot.firstElementChild?.getBoundingClientRect();
                const bounds = slot.getBoundingClientRect();
                gaps.push(
                  box
                    ? Math.max(
                        Math.abs(box.left - bounds.left),
                        Math.abs(box.top - bounds.top),
                        Math.abs(box.width - bounds.width),
                        Math.abs(box.height - bounds.height),
                      )
                    : Infinity,
                );
              }
            }
          });
        });
        for (const shell of document.querySelectorAll(".dv-shell")) {
          observer.observe(shell.parentElement!);
        }
        return { gaps, observer };
      });

      const handle = page.locator('[role="separator"][aria-orientation="vertical"]').first();
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x - 160, box.y + 100, { steps: 20 });
      await page.mouse.move(box.x + 80, box.y + 100, { steps: 20 });
      await page.mouse.up();
      await page.setViewportSize({ width: 1400, height: 850 });
      // Let the viewport resize reach its observers before reading their measurements.
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
      });
      const gaps = await measurements.evaluate((measurement) => {
        measurement.observer.disconnect();
        return measurement.gaps;
      });
      await measurements.dispose();
      expect(gaps.length).toBeGreaterThan(20);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(1);
      expect(pageErrors).toEqual([]);
    });
  }

  test("stacks a panel dropped on the middle of another as tabs", async ({ page }) => {
    await stackImageOn3D(page);
  });

  test("keeps the 3D canvas across tab switches and maximize", async ({ page }) => {
    const panel = page.locator('[data-testid^="panel-mouseenter-container 3D!"]');
    const canvas = await panel
      .locator("canvas")
      .first()
      .evaluateHandle((element: HTMLCanvasElement) => element);
    await stackImageOn3D(page);
    await expect(page.locator(".dv-render-overlay")).toHaveCount(0);
    expect(await canvas.evaluate((element) => element.isConnected)).toBe(false);

    for (let i = 0; i < 3; i++) {
      await selectTab(page, "3D");
      await expect(panel).toBeVisible();
      expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
      await selectTab(page, "Image");
      expect(await canvas.evaluate((element) => element.isConnected)).toBe(false);
    }
    await selectTab(page, "3D");
    const before = (await panel.boundingBox())!;
    await panel.hover();
    await panel.getByTitle("fullscreen", { exact: true }).click();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(before.width);
    await panel.getByTitle("Exit fullscreen", { exact: true }).click();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(before.width, 0);
    expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
    expect(await canvas.evaluate((element) => element.getContext("webgl2")?.isContextLost())).toBe(
      false,
    );
    await canvas.dispose();
  });

  test("restores a nested layout after its outer tab was hidden and resized", async ({ page }) => {
    await drag(page, await catalogItem(page, "Tab"), inGroup(page, "3D", 0.5, 0.5));
    const panel = page.locator('[data-testid^="panel-mouseenter-container Tab!"]');
    await panel.getByTestId("panel-grid-card Image").click();
    const innerGrid = panel.locator(".dv-dockview");
    await expect(innerGrid).toBeVisible();
    const grid = await innerGrid.evaluateHandle((element) => element);
    await selectTab(page, "3D");
    expect(await grid.evaluate((element) => element.isConnected)).toBe(false);
    await page.setViewportSize({ width: 1350, height: 850 });
    await selectTab(page, "Tab");
    await expect(innerGrid).toBeVisible();
    expect(await grid.evaluate((element) => element.isConnected)).toBe(true);
    await expect
      .poll(
        async () =>
          await innerGrid.evaluate((element) =>
            Math.abs(element.clientWidth - element.parentElement!.clientWidth),
          ),
      )
      .toBeLessThanOrEqual(1);
    await expect(panel.locator('[data-testid^="panel-mouseenter-container Image!"]')).toBeVisible();
    await grid.dispose();
  });

  test("keeps the Plot canvas and cursor working after a hidden-tab resize", async ({ page }) => {
    await loadFiles({ mainWindow: page, filenames: "example-2.mcap" });
    await page.getByTestId("AddPanelButton").click();
    await page.getByTestId("panel-menu-item Plot").click();
    await page.getByTestId("add-series").click();
    await page
      .getByTestId("settings-tree-editor")
      .getByPlaceholder("/some/topic.msgs[0].field")
      .fill("mouse.clientX");
    const panel = page.locator('[data-testid^="panel-mouseenter-container Plot!"]');
    await expect(panel.getByTestId("plot-legend-row-path-label")).toHaveText("mouse.clientX");
    const canvas = await panel.locator("canvas").evaluateHandle((element) => element);
    await drag(page, async () => await toolbarOf(page, "Plot"), inGroup(page, "3D", 0.5, 0.5));
    await selectTab(page, "3D");
    expect(await canvas.evaluate((element) => element.isConnected)).toBe(false);
    await page.setViewportSize({ width: 1400, height: 900 });
    await selectTab(page, "Plot");
    await expect(panel).toBeVisible();
    expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
    await expect
      .poll(async () => {
        const bounds = (await panel.getByTestId("vertical-bar-wrapper").boundingBox())!;
        const x = bounds.x + bounds.width * 0.6;
        await page.mouse.move(x, bounds.y + bounds.height * 0.5);
        return await panel
          .getByTestId("hover-bar")
          .evaluate(
            (element, mouseX) => Math.abs(element.getBoundingClientRect().left - mouseX),
            x,
          );
      })
      .toBeLessThanOrEqual(2);
    await canvas.dispose();
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
      async () => {
        await expect(page.locator(".dv-tab", { hasText: "3D" })).toHaveClass(/dv-active-tab/);
      },
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
