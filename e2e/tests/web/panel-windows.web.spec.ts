// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

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
    .getByTestId("panel-menu")
    .first()
    .locator("xpath=ancestor::*[@data-telemetry-id='panel']")
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
