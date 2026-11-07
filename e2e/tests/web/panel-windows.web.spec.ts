// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("DataSourceDialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("DataSourceDialog")).toBeHidden();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
});

test("opens independent panel windows and restores both on close", async ({ page }) => {
  await page.getByTestId("panel-menu").first().click();
  const firstOpened = page.waitForEvent("popup");
  await page.getByText("Open in new window", { exact: true }).click();
  const first = await firstOpened;
  await expect(first).toHaveTitle("3D");
  await expect(first.locator("canvas")).toHaveCount(1);
  await expect(page.getByTestId("panel-menu")).toHaveCount(2);

  await page.getByTestId("panel-menu").first().click();
  const secondOpened = page.waitForEvent("popup");
  await page.getByText("Open in new window", { exact: true }).click();
  const second = await secondOpened;
  await expect(second).toHaveTitle("Image");
  await expect(page.getByTestId("panel-menu")).toHaveCount(1);
  await expect(first.getByTestId("panel-menu")).toBeVisible();

  await second.close();
  await expect(page.getByTestId("panel-menu")).toHaveCount(2);
  await first.close();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
});

test("opens one always-on-top PiP monitor and returns it to the workspace", async ({ page }) => {
  test.skip(
    !(await page.evaluate(() => "documentPictureInPicture" in window)),
    "Document PiP unavailable",
  );
  await page.getByTestId("panel-menu").first().click();
  const opened = page.waitForEvent("popup");
  await page.getByText("Open Picture-in-Picture monitor", { exact: true }).click();
  const monitor = await opened;
  await expect(monitor).toHaveTitle("3D");
  await expect(monitor.locator("canvas")).toHaveCount(1);
  await expect(page.getByTestId("panel-menu")).toHaveCount(2);
  await monitor.close();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
});

test("keeps ordinary pop-outs available when Document PiP is unsupported", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "documentPictureInPicture", { value: undefined });
  });
  await page.reload();
  await page.getByTestId("DataSourceDialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("DataSourceDialog")).toBeHidden();
  await expect(page.getByTestId("panel-menu")).toHaveCount(3);
  await page.getByTestId("panel-menu").first().click();
  await expect(page.getByText("Open Picture-in-Picture monitor", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Open in new window", { exact: true })).toBeVisible();
});
