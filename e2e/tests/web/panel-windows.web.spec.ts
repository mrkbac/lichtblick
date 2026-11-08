// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, Page, test } from "@playwright/test";

import { loadFiles } from "../../fixtures/load-files";

test.beforeEach(async ({ page }) => {
  // Given
  await page.goto("/");
  await page.getByTestId("DataSourceDialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("DataSourceDialog")).toBeHidden();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
});

test("opens independent panel windows and removes their views on close", { tag: "@smoke" }, async ({
  page,
}) => {
  // When
  await page.getByTestId("panel-menu").first().click();
  const firstOpened = page.waitForEvent("popup");
  await page.getByText("Open in new window", { exact: true }).click();
  const first = await firstOpened;
  // Then
  await expect(first).toHaveTitle("3D");
  await expect(first.locator("canvas")).toHaveCount(1);
  await expect(page.getByTestId("panel-menu")).toHaveCount(2);
  await expect(page.locator(".dv-groupview:visible")).toHaveCount(2);
  const remaining = await page
    .getByTestId(/^panel-mouseenter-container/)
    .filter({ has: page.getByTestId("panel-menu") })
    .first()
    .boundingBox();
  const workspace = await page.locator(".dockview-theme-lichtblick").first().boundingBox();
  expect(remaining!.x).toBeCloseTo(workspace!.x, 0);
  expect(remaining!.width).toBeCloseTo(workspace!.width, 0);

  // When
  await page.getByTestId("panel-menu").first().click();
  const secondOpened = page.waitForEvent("popup");
  await page.getByText("Open in new window", { exact: true }).click();
  const second = await secondOpened;
  await expect(second).toHaveTitle("Image");
  await expect(page.getByTestId("panel-menu")).toHaveCount(1);
  await expect(page.locator(".dv-groupview:visible")).toHaveCount(1);
  await expect(first.getByTestId("panel-menu")).toBeVisible();

  // Closing a window removes its views without returning them to the layout.
  await second.close();
  await expect(page.getByTestId("panel-menu")).toHaveCount(1);
  await first.close();
  await expect(page.getByTestId("panel-menu")).toHaveCount(1);
});

test("opens one always-on-top PiP monitor and returns it to the workspace", {
  tag: "@regression",
}, async ({ page }) => {
  // Given
  test.skip(
    !(await page.evaluate(() => "documentPictureInPicture" in window)),
    "Document PiP unavailable",
  );
  // When
  await page.getByTestId("panel-menu").first().click();
  const opened = page.waitForEvent("popup");
  await page.getByText("Open Picture-in-Picture monitor", { exact: true }).click();
  const monitor = await opened;
  // Then
  await expect(monitor).toHaveTitle("3D");
  await expect(monitor.locator("canvas")).toHaveCount(1);
  await expect(page.getByTestId("panel-menu")).toHaveCount(2);
  await expect(page.getByText("Show panel window", { exact: true })).toBeVisible();
  // When
  await monitor.getByTestId("panel-menu").click();
  await monitor.getByText("Return to workspace", { exact: true }).click();
  // Then
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
});

test("keeps ordinary pop-outs available when Document PiP is unsupported", {
  tag: "@regression",
}, async ({ page }) => {
  // Given
  await page.addInitScript(() => {
    Object.defineProperty(window, "documentPictureInPicture", { value: undefined });
  });
  await page.reload();
  await page.getByTestId("DataSourceDialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("DataSourceDialog")).toBeHidden();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
  // When
  await page.getByTestId("panel-menu").first().click();
  // Then
  await expect(page.getByText("Open Picture-in-Picture monitor", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Open in new window", { exact: true })).toBeVisible();
});

for (const action of ["Open in new window", "Open Picture-in-Picture monitor"] as const) {
  test(`keeps a paused recording image when using ${action}`, { tag: "@regression" }, async ({
    page,
  }) => {
    // Given an image already visible in a paused recording
    test.skip(
      action === "Open Picture-in-Picture monitor" &&
        !(await page.evaluate(() => "documentPictureInPicture" in window)),
      "Document PiP unavailable",
    );
    await loadFiles({ mainWindow: page, filenames: "custom-camera-model.mcap" });
    const image = page
      .getByTestId(/^panel-mouseenter-container/)
      .filter({ has: page.getByText("/image/compressed", { exact: true }) })
      .first();
    await expect(image.locator("canvas")).toBeVisible();
    await expect(image.getByText("Waiting for image messages…", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("play-button")).toHaveAttribute("title", "Play");
    // When its renderer moves to another window without playback advancing
    await image.getByTestId("panel-menu").click();
    const opened = page.waitForEvent("popup");
    await page.getByText(action, { exact: true }).click();
    const monitor = await opened;
    // Then the paused image is available there
    await expect(monitor.getByText("/image/compressed", { exact: true })).toBeVisible();
    await expect(monitor.locator("canvas")).toBeVisible();
    await expect(monitor.getByText("Waiting for image messages…", { exact: true })).toHaveCount(0);
    // Explicitly returning the panel preserves the same paused image.
    await monitor.getByTestId("panel-menu").click();
    await monitor.getByText("Return to workspace", { exact: true }).click();
    // Then no seek or playback is needed to recover it
    await expect(image.locator("canvas")).toBeVisible();
    await expect(image.getByText("Waiting for image messages…", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("play-button")).toHaveAttribute("title", "Play");
  });
}

test("keeps typing shortcuts inside inherited editable fields", { tag: "@regression" }, async ({
  page,
}) => {
  // Given a floating panel and an observer for shortcuts reaching the opener
  await page.evaluate(() => {
    const tracked = window as Window & { forwardedSpaces: number };
    tracked.forwardedSpaces = 0;
    document.addEventListener("keydown", (event) => {
      if (event.key === " ") {
        tracked.forwardedSpaces++;
      }
    });
  });
  await page.getByTestId("panel-menu").first().click();
  const opened = page.waitForEvent("popup");
  await page.getByText("Open in new window", { exact: true }).click();
  const monitor = await opened;
  // When Space is typed into empty, plaintext-only, and inherited editable states
  for (const value of ["", "plaintext-only", "true"]) {
    await monitor.evaluate((attribute) => {
      const root = document.createElement("div");
      root.setAttribute("contenteditable", attribute);
      const target = document.createElement("span");
      target.dataset.testid = "editable-target";
      target.tabIndex = 0;
      root.appendChild(target);
      document.body.appendChild(root);
    }, value);
    await monitor.getByTestId("editable-target").press("Space");
    await monitor.getByTestId("editable-target").evaluate((element) => {
      element.parentElement!.remove();
    });
  }
  // Then none of those typing events becomes an app shortcut in the opener
  expect(
    await page.evaluate(() => (window as Window & { forwardedSpaces: number }).forwardedSpaces),
  ).toBe(0);
  await monitor.close();
});

test("creates a blank monitor from the top bar and restores its contents with one click", {
  tag: "@smoke",
}, async ({ page }) => {
  // Given an ordinary browser without Window Management permission support.
  await page.addInitScript(() => {
    Object.defineProperty(window, "getScreenDetails", { configurable: true, value: undefined });
  });
  await page.reload();
  await page.getByTestId("AddPanelButton").waitFor();
  const initialDialog = page.getByTestId("DataSourceDialog");
  if (await initialDialog.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(initialDialog).toBeHidden();
  }
  // When New window is clicked, it opens directly without another panel picker.
  const opened = page.waitForEvent("popup");
  await page.getByTestId("new-window-button").click();
  const monitor = await opened;
  await expect(monitor).toHaveTitle("New window");
  await expect(monitor.getByTestId("empty-drop-target")).toBeVisible();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
  // Then the existing catalog builds the monitor's contents in its own window.
  await monitor.getByTestId("panel-grid-card Image").click();
  await expect(monitor.getByTestId("panel-menu")).toHaveCount(2);
  await expect(monitor.getByTestId("empty-drop-target")).toHaveCount(0);
  await expect(page.getByTestId("save-monitor-setup")).toBeEnabled();

  // When the arrangement is saved and both pages are recreated, nothing opens automatically.
  await page.getByTestId("save-monitor-setup").click();
  await expect(
    page.getByText("Monitor setup saved on this computer for this layout."),
  ).toBeVisible();
  await monitor.close();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
  await page.reload();
  await page.getByTestId("AddPanelButton").waitFor();
  const dialog = page.getByTestId("DataSourceDialog");
  if (await dialog.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  await expect(page.getByTestId("restore-monitor-setup")).toBeEnabled();
  expect(page.context().pages()).toHaveLength(1);
  // Then a single Restore click reopens the monitor with its configured Image panel.
  const restored = page.waitForEvent("popup");
  await page.getByTestId("restore-monitor-setup").click();
  const returned = await restored;
  await expect(returned).toHaveTitle("New window");
  await expect(returned.getByTestId("panel-menu")).toHaveCount(2);
  await expect(returned.getByTestId("empty-drop-target")).toHaveCount(0);
  await returned.close();
});

test("restores several existing panel windows when screen permission is denied", {
  tag: "@regression",
}, async ({ page }) => {
  // Given two ordinary pop-outs and a denied Window Management permission.
  await page.evaluate(() => {
    Object.defineProperty(window, "getScreenDetails", {
      configurable: true,
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  const monitors: Page[] = [];
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("panel-menu").first().click();
    const opened = page.waitForEvent("popup");
    await page.getByText("Open in new window", { exact: true }).click();
    monitors.push(await opened);
  }
  await page.getByTestId("save-monitor-setup").click();
  await expect(
    page.getByText("Monitor setup saved on this computer for this layout."),
  ).toBeVisible();
  for (const monitor of monitors) {
    await monitor.close();
  }
  await expect(page.getByTestId("panel-menu")).toHaveCount(1);
  // When Restore is clicked once, normal pop-outs remain available without screen permission.
  const restored: Page[] = [];
  page.on("popup", (monitor) => {
    restored.push(monitor);
  });
  await page.getByTestId("restore-monitor-setup").click();
  await expect.poll(() => restored.length).toBe(2);
  // Then both panels are live in their windows and no duplicate panel remains in the workspace.
  await expect(page.getByTestId("panel-menu")).toHaveCount(1);
  for (const monitor of restored) {
    await expect(monitor.getByTestId("panel-menu")).toHaveCount(1);
    await monitor.close();
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`renders newly created views with window-local settings and matching PWA colors (${colorScheme})`, {
    tag: "@regression",
  }, async ({ page }) => {
    // Given the main window's selected color scheme and untouched settings sidebar.
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    const mainSettings = await page.getByTestId("sidebar-left").innerText();
    const opened = page.waitForEvent("popup");
    await page.getByTestId("new-window-button").click();
    const monitor = await opened;
    // When a new 3D view is created in the blank window, it gets the app's scoped layout styles.
    await monitor.getByTestId("panel-grid-card 3D").click();
    await expect(monitor.locator("canvas")).toBeVisible();
    const canvas = await monitor.locator("canvas").boundingBox();
    expect(canvas!.height).toBeGreaterThan(100);
    await expect(monitor.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    expect(await monitor.locator('meta[name="theme-color"]').getAttribute("content")).toBe(
      await page.locator('meta[name="theme-color"]').getAttribute("content"),
    );
    const headerColor = (element: HTMLElement) =>
      getComputedStyle(element.closest('[data-tourid="app-bar"]')!).backgroundColor;
    expect(await monitor.getByTestId("window-left-sidebar-button").evaluate(headerColor)).toBe(
      await page.getByTestId("AddPanelButton").evaluate(headerColor),
    );
    // Then the panel's settings stay in its own left sidebar and leave the main settings alone.
    await monitor.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(monitor.getByTestId("sidebar-left")).toBeVisible();
    await expect(monitor.getByTestId("sidebar-left").getByRole("heading")).toContainText("3D");
    expect(await page.getByTestId("sidebar-left").innerText()).toBe(mainSettings);
    await monitor.getByTestId("sidebar-close-left").click();
    await expect(monitor.getByTestId("sidebar-left")).toHaveCount(0);
    await monitor.getByTestId("window-left-sidebar-button").click();
    await expect(monitor.getByTestId("sidebar-left")).toBeVisible();
    await expect(monitor.getByTestId("window-left-sidebar-button")).toHaveCSS(
      "-webkit-app-region",
      "no-drag",
    );
    await monitor.getByTestId("window-left-sidebar-button").click();
    await expect(monitor.getByTestId("sidebar-left")).toHaveCount(0);
    // A second view created through + also stays in this monitor.
    await monitor.getByTestId("add-tab").click();
    await monitor.getByTestId("panel-menu-item Plot").click();
    await expect(monitor.getByRole("tab", { name: "Plot", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(monitor.getByTestId("empty-drop-target")).toHaveCount(0);
    // Theme changes keep the already-open window and its PWA chrome in sync.
    const nextScheme = colorScheme === "dark" ? "light" : "dark";
    await page.emulateMedia({ colorScheme: nextScheme });
    await expect(monitor.locator("html")).toHaveAttribute("data-color-mode", nextScheme);
    expect(await monitor.locator('meta[name="theme-color"]').getAttribute("content")).toBe(
      await page.locator('meta[name="theme-color"]').getAttribute("content"),
    );
    expect(await monitor.getByTestId("window-left-sidebar-button").evaluate(headerColor)).toBe(
      await page.getByTestId("AddPanelButton").evaluate(headerColor),
    );
    await monitor.close();
  });
}

test("styles a Map added after the monitor opens", { tag: "@regression" }, async ({ page }) => {
  // Given a blank monitor opened before the Map library's global CSS is loaded.
  const opened = page.waitForEvent("popup");
  await page.getByTestId("new-window-button").click();
  const monitor = await opened;
  // When Map is created, its library stylesheet must also reach this document.
  await monitor.getByTestId("panel-grid-card Map").click();
  const map = monitor.locator(".maplibregl-map");
  await expect(map).toBeVisible();
  // Then library layout rules apply, keeping the canvas and controls inside the panel.
  await expect(map).toHaveCSS("position", "relative");
  await expect(map).toHaveCSS("overflow", "hidden");
  await expect(map.locator("canvas")).toBeVisible();
  const bounds = await map.boundingBox();
  expect(bounds!.height).toBeGreaterThan(100);
  expect(bounds!.height).toBeLessThanOrEqual(await monitor.evaluate(() => innerHeight));
  await monitor.close();
});

test.describe("native window resizing", () => {
  test.use({ viewport: null });

  for (const panelName of ["3D", "Camera Grid"]) {
    test(`sizes ${panelName} within two frames and matches the main panel controls`, async ({
      page,
    }) => {
      if (panelName === "Camera Grid") {
        await loadFiles({ mainWindow: page, filenames: "custom-camera-model.mcap" });
      }
      const mainSize = await page.getByTestId("panel-menu").first().boundingBox();
      const opened = page.waitForEvent("popup");
      await page.getByTestId("new-window-button").click();
      const monitor = await opened;
      await monitor.getByTestId(`panel-grid-card ${panelName}`).click();
      if (panelName === "Camera Grid") {
        await monitor.getByRole("button", { name: /Add all/ }).click();
      }
      await expect(monitor.locator("canvas").first()).toBeVisible();
      const childSize = await monitor.getByTestId("panel-menu").last().boundingBox();
      expect(childSize!.width).toBe(mainSize!.width);
      expect(childSize!.height).toBe(mainSize!.height);
      expect(await monitor.locator("html").evaluate((el) => getComputedStyle(el).fontSize)).toBe(
        await page.locator("html").evaluate((el) => getComputedStyle(el).fontSize),
      );
      await monitor.bringToFront();
      const cdp = await page.context().newCDPSession(monitor);
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      for (const [width, height] of [
        [720, 480],
        [1100, 800],
        [600, 500],
      ]) {
        await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width, height } });
        const size = await monitor.evaluate(async () => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const canvas = document.querySelector("canvas")!;
          const rect = canvas.getBoundingClientRect();
          return {
            width: innerWidth,
            height: innerHeight,
            right: rect.right,
            bottom: rect.bottom,
            bufferWidth: canvas.width,
            bufferHeight: canvas.height,
            canvasWidth: rect.width,
            canvasHeight: rect.height,
            ratio: devicePixelRatio,
          };
        });
        expect(Math.abs(size.right - size.width)).toBeLessThan(2);
        expect(Math.abs(size.bottom - size.height)).toBeLessThan(2);
        expect(Math.abs(size.bufferWidth - size.canvasWidth * size.ratio)).toBeLessThan(2);
        expect(Math.abs(size.bufferHeight - size.canvasHeight * size.ratio)).toBeLessThan(2);
      }
      await cdp.detach();
      await monitor.close();
      await expect(page.getByTestId("panel-menu")).toHaveCount(3);
    });
  }
});
