// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

// Real browser handles and IndexedDB cloning; only the native chooser is substituted.
/**
 * GIVEN a synthetic extension folder with real browser handles
 * WHEN it is selected, restored, reloaded, and uninstalled
 * THEN disk edits are read and uninstall preserves its files
 */
test("loads, restores, reloads, and forgets a disk extension", { tag: "@smoke" }, async ({
  page,
}) => {
  // Given
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle("test-extension", { create: true });
    };
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(
      "test-extension",
      { create: true },
    );
    const pkg = await (
      await directory.getFileHandle("package.json", { create: true })
    ).createWritable();
    await pkg.write(
      JSON.stringify({
        name: "disk-test",
        publisher: "e2e",
        displayName: "Disk test",
        version: "1.0.0",
        description: "Disk extension regression",
      }),
    );
    await pkg.close();
    const dist = await directory.getDirectoryHandle("dist", { create: true });
    const source = await (
      await dist.getFileHandle("extension.js", { create: true })
    ).createWritable();
    await source.write(
      'module.exports.activate = () => { document.documentElement.dataset.diskExtensionVersion = "1"; };',
    );
    await source.close();
  });
  await page.keyboard.press("Escape");
  await page.getByTestId("AppMenuButton").click();
  await page.getByRole("menuitem", { name: "Extensions…", exact: true }).click();
  // When
  await page.getByRole("button", { name: "Load extension folder" }).click();
  // Then
  await expect(page.locator("html")).toHaveAttribute("data-disk-extension-version", "1");
  await expect(page.getByRole("cell", { name: "Disk test", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-disk-extension-version", "1");
  await page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(
      "test-extension",
    );
    const source = await (
      await (await directory.getDirectoryHandle("dist")).getFileHandle("extension.js")
    ).createWritable();
    await source.write(
      'module.exports.activate = () => { document.documentElement.dataset.diskExtensionVersion = "2"; };',
    );
    await source.close();
  });
  await page.keyboard.press("Escape");
  await page.getByTestId("AppMenuButton").click();
  await page.getByRole("menuitem", { name: "Extensions…", exact: true }).click();
  await page.getByRole("button", { name: "Reload disk extensions" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-disk-extension-version", "2");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Disk test", exact: true }) });
  await row.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Disk test", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(
        "test-extension",
      );
      return (await (await dir.getFileHandle("package.json")).getFile()).size > 0;
    }),
  ).toBe(true);
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-disk-extension-version");
});

/**
 * GIVEN a folder picker that cancels or denies access
 * WHEN the user attempts to select a folder
 * THEN cancellation is silent and denied access is reported
 */
test("handles picker cancellation and denial without installing an extension", {
  tag: "@regression",
}, async ({ page }) => {
  // Given
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      throw new DOMException("Cancelled", "AbortError");
    };
  });
  await page.goto("/");
  await page.getByTestId("AppMenuButton").click();
  await page.getByRole("menuitem", { name: "Extensions…", exact: true }).click();
  const load = page.getByRole("button", { name: "Load extension folder" });
  // When
  await load.click();
  // Then
  await expect(load).toBeEnabled();
  await expect(page.getByText("Cancelled", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.showDirectoryPicker = async () => {
      throw new DOMException("Folder access denied", "NotAllowedError");
    };
  });
  await load.click();
  await expect(page.getByText("Folder access denied", { exact: true })).toBeVisible();
  await expect(load).toBeEnabled();
});

/**
 * GIVEN directory selection is unavailable
 * WHEN extension settings are opened
 * THEN folder actions are hidden and ordinary settings remain available
 */
test("hides folder actions when directory access is unsupported", { tag: "@regression" }, async ({
  page,
}) => {
  // Given
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showDirectoryPicker");
  });
  await page.goto("/");
  await page.getByTestId("AppMenuButton").click();
  // When
  await page.getByRole("menuitem", { name: "Extensions…", exact: true }).click();
  // Then
  await expect(page.getByPlaceholder("Search extensions...")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Load extension folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reload disk extensions" })).toHaveCount(0);
});
