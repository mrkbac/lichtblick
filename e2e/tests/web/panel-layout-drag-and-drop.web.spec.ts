// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Locator, Page, expect, test } from "@playwright/test";

import { loadFiles } from "../../fixtures/load-files";

/**
 * Drags panels with real mouse input (native HTML5 drag and drop in Chromium) and checks the
 * resulting layout. The default layout is 3D on the left, Image above Raw Messages on the right.
 * Panels dropped onto each other become a Tab panel, whose tabs each hold their own layout.
 */

type Point = [number, number];

/** The root layout as one entry per group, by panel title ("Tab" for a Tab panel). */
async function groups(page: Page): Promise<string[]> {
  return await page.locator(".dv-groupview").evaluateAll((els) =>
    els
      // Groups of the layouts inside Tab panels sit inside another panel layout.
      .filter(
        (g) =>
          g.closest("[data-panel-layout]")?.parentElement?.closest("[data-panel-layout]") ==
          undefined,
      )
      .map((g) =>
        [...g.querySelectorAll(":scope > .dv-tabs-and-actions-container .dv-tab")]
          .map((t) => t.textContent)
          .join("|"),
      ),
  );
}

/** The tab titles of the (only) Tab panel, the shown one marked with "*". */
async function tabs(page: Page): Promise<string[]> {
  return await page
    .getByTestId("tab-panel-tab")
    .evaluateAll((els) =>
      els.map((t) => (t.getAttribute("aria-selected") === "true" ? "*" : "") + t.textContent),
    );
}

async function drag(
  page: Page,
  source: Point | (() => Promise<Point>),
  to: () => Promise<Point>,
  /** Waits for a state that must hold before the drop, e.g. a hovered tab opening. */
  beforeDrop?: () => Promise<void>,
) {
  // Retry until the drag has started, in case something covered the drag handle.
  await expect(async () => {
    const from = typeof source === "function" ? await source() : source;
    await page.evaluate(() => {
      (window as { panelDragStarted?: boolean }).panelDragStarted = false;
      document.addEventListener(
        "dragstart",
        () => ((window as { panelDragStarted?: boolean }).panelDragStarted = true),
        { once: true, capture: true },
      );
    });
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(from[0] + 10, from[1] + 10, { steps: 3 });
    // Drag events need movement after the drag has started.
    await page.mouse.move(from[0] + 30, from[1] + 40, { steps: 3 });
    try {
      await page.waitForFunction(
        () => (window as { panelDragStarted?: boolean }).panelDragStarted === true,
        undefined,
        { timeout: 2000 },
      );
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

function group(page: Page, title: string): Locator {
  // The catalog menu hides the underlying app from accessibility queries during a drag.
  return page.getByRole("region", { name: title, exact: true, includeHidden: true });
}

/** A point in a group, as fractions of its size. */
function inGroup(page: Page, title: string, fx: number, fy: number) {
  return async (): Promise<Point> => {
    const box = (await group(page, title).boundingBox())!;
    return [box.x + box.width * fx, box.y + box.height * fy];
  };
}

/** A point `px` pixels inside the left edge of a group, halfway down. */
function nearLeftEdge(page: Page, title: string, px: number) {
  return async (): Promise<Point> => {
    const box = (await group(page, title).boundingBox())!;
    return [box.x + px, box.y + box.height / 2];
  };
}

function centerOf(locator: Locator) {
  return async (): Promise<Point> => {
    const box = (await locator.boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
}

/** Select a Tab-panel tab by title and wait until it is active. */
async function selectTab(page: Page, title: string) {
  const tab = page.getByTestId("tab-panel-tab").filter({ hasText: title });
  await tab.getByText(title, { exact: true }).click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/**
 * A grab point on the toolbar of the panel of `type`. Panels with their own toolbar content drag
 * by the toolbar's controls.
 */
async function toolbarOf(page: Page, type: string): Promise<Point> {
  const panel = page.locator(`[data-testid^="panel-mouseenter-container ${type}!"]`);
  return await panel.getByTestId("panel-drag-grip").evaluate(async (grip: HTMLElement) => {
    // Panels are repositioned on the next frame after a layout change.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = grip.getBoundingClientRect();
    return [box.x + box.width / 2, box.y + box.height / 2] as Point;
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
    await expect.poll(async () => await groups(page)).toEqual(["Tab", "Raw Messages"]);
    await expect.poll(async () => await tabs(page)).toEqual(["3D", "*Image"]);
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
        await stackImageOn3D(page);
        await expect(
          page.locator('[data-testid^="panel-mouseenter-container Image!"]'),
        ).toBeVisible();
        await expect(page.locator(".dv-dockview")).toHaveCount(3);
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

  test("makes a Tab panel when a panel is dropped on the middle of another", async ({ page }) => {
    await stackImageOn3D(page);
  });

  test("keeps the 3D canvas across tab switches and maximize", async ({ page }) => {
    await stackImageOn3D(page);
    await selectTab(page, "3D");
    const panel = page.locator('[data-testid^="panel-mouseenter-container 3D!"]');
    const canvas = await panel
      .locator("canvas")
      .first()
      .evaluateHandle((element: HTMLCanvasElement) => element);
    await expect(page.locator(".dv-render-overlay")).toHaveCount(0);

    for (let i = 0; i < 3; i++) {
      await selectTab(page, "3D");
      await expect(panel).toBeVisible();
      expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
      await selectTab(page, "Image");
      await expect(panel).toBeHidden();
      expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
    }
    await selectTab(page, "3D");
    const before = (await panel.boundingBox())!;
    const outer = page.locator('[data-testid^="panel-mouseenter-container Tab!"]');
    await outer.hover();
    await outer.getByTitle("fullscreen", { exact: true }).first().click();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(before.width);
    await outer.getByTitle("Exit fullscreen", { exact: true }).first().click();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(before.width, 0);
    expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
    expect(await canvas.evaluate((element) => element.getContext("webgl2")?.isContextLost())).toBe(
      false,
    );
    await canvas.dispose();
  });

  test("restores a nested layout after its outer tab was hidden and resized", async ({ page }) => {
    await stackImageOn3D(page);
    const panel = page.locator('[data-testid^="panel-mouseenter-container Image!"]');
    await expect(panel).toBeVisible();
    const grid = await panel.evaluateHandle((element) => element.closest(".dv-dockview")!);
    await selectTab(page, "3D");
    await expect(panel).toBeHidden();
    expect(await grid.evaluate((element) => element.isConnected)).toBe(true);
    await page.setViewportSize({ width: 1350, height: 850 });
    await selectTab(page, "Image");
    await expect(panel).toBeVisible();
    expect(await grid.evaluate((element) => element.isConnected)).toBe(true);
    await expect
      .poll(
        async () =>
          await grid.evaluate((element) =>
            Math.abs(element.clientWidth - element.parentElement!.clientWidth),
          ),
      )
      .toBeLessThanOrEqual(1);
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
    await drag(page, async () => await toolbarOf(page, "Plot"), inGroup(page, "3D", 0.5, 0.5));
    await expect(panel).toBeVisible();
    const canvas = await panel.locator("canvas").evaluateHandle((element) => element);
    await selectTab(page, "3D");
    await expect(panel).toBeHidden();
    expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
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

  test("splits inside a tab", async ({ page }) => {
    await stackImageOn3D(page);
    await drag(
      page,
      async () => await toolbarOf(page, "RawMessages"),
      inGroup(page, "Image", 0.95, 0.5),
    );
    await expect.poll(async () => await groups(page)).toEqual(["Tab"]);
    await expect.poll(async () => await tabs(page)).toEqual(["3D", "*Image + Raw Messages"]);
  });

  test("splits beside a Tab panel in the band along its edge", async ({ page }) => {
    await stackImageOn3D(page);
    await drag(
      page,
      async () => await toolbarOf(page, "RawMessages"),
      nearLeftEdge(page, "Tab", 8),
    );
    await expect.poll(async () => await groups(page)).toEqual(["Raw Messages", "Tab"]);
  });

  test("moving the last but one tab out turns the Tab panel back into a panel", async ({
    page,
  }) => {
    await stackImageOn3D(page);
    await drag(
      page,
      async () => await toolbarOf(page, "Image"),
      inGroup(page, "Raw Messages", 0.97, 0.5),
    );
    await expect.poll(async () => await groups(page)).toEqual(["3D", "Raw Messages", "Image"]);
    await expect(page.getByTestId("tab-panel-tab")).toHaveCount(0);
  });

  test("opens a background tab on hover and drops into it", async ({ page }) => {
    await stackImageOn3D(page);
    const tab3D = page.getByTestId("tab-panel-tab").filter({ hasText: "3D" });
    await drag(
      page,
      async () => await toolbarOf(page, "RawMessages"),
      centerOf(tab3D),
      async () => {
        await expect(tab3D).toHaveAttribute("aria-selected", "true");
      },
    );
    await expect.poll(async () => await tabs(page)).toEqual(["*3D + Raw Messages", "Image"]);
  });

  test("adds a tab when a panel is dropped on the tab strip", async ({ page }) => {
    await stackImageOn3D(page);
    await drag(
      page,
      async () => await toolbarOf(page, "RawMessages"),
      async () => {
        const box = (await page.locator("[data-tab-strip]").boundingBox())!;
        return [box.x + box.width - 20, box.y + box.height / 2];
      },
    );
    await expect.poll(async () => await tabs(page)).toEqual(["3D", "Image", "*Raw Messages"]);
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
      .toEqual(["Tab", "Raw Messages", "Image", "Raw Messages"]);
    await expect.poll(async () => await tabs(page)).toEqual(["3D", "*Image"]);
  });
});
