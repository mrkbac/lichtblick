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

test("opens independent panel windows and restores both on close", { tag: "@smoke" }, async ({
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

  // When both windows close, their panels return to the layout.
  await second.close();
  await expect(page.getByTestId("panel-menu")).toHaveCount(2);
  await first.close();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
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
    // When that window closes, the same paused image returns to the workspace
    await monitor.close();
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
  await page.evaluate(() => {
    Object.defineProperty(window, "getScreenDetails", { configurable: true, value: undefined });
  });
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
  await page.reload();
  const dialog = page.getByTestId("DataSourceDialog");
  if (await dialog.isVisible()) {
    await page.keyboard.press("Escape");
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
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
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
