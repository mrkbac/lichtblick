// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

test("discovers ROS packages in a granted folder and removes the grant @regression", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Exercise real browser directory/file handles without automating the native picker dialog.
    const folderPromise = (async () => {
      const root = await navigator.storage.getDirectory();
      const workspace = await root.getDirectoryHandle("ros-workspace", { create: true });
      const pkg = await workspace.getDirectoryHandle("robot-description", { create: true });
      const manifest = await pkg.getFileHandle("package.xml", { create: true });
      const writer = await manifest.createWritable();
      await writer.write("<package><name>robot</name></package>");
      await writer.close();
      return workspace;
    })();
    window.showDirectoryPicker = async () => await folderPromise;
  });
  await page.goto("/");
  await page.keyboard.press("Escape");
  await page.locator("#app-menu-button").click();
  await page.getByTestId("menu-item-settings").click();
  await page.getByRole("button", { name: "Select resource folder" }).click();
  await expect(page.getByText("ros-workspace — 1 ROS package", { exact: true })).toBeVisible();
  await expect(page.getByText(/^local-asset:\/\//)).toBeVisible();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const workspace = await root.getDirectoryHandle("ros-workspace");
    const pkg = await workspace.getDirectoryHandle("new-description", { create: true });
    const manifest = await pkg.getFileHandle("package.xml", { create: true });
    const writer = await manifest.createWritable();
    await writer.write("<package><name>new_robot</name></package>");
    await writer.close();
  });
  // Selecting the same handle refreshes the index rather than creating a duplicate root.
  await page.getByRole("button", { name: "Select resource folder" }).click();
  await expect(page.getByRole("button", { name: "Select resource folder" })).toBeEnabled();
  await expect(page.getByText("ros-workspace — 2 ROS packages", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove folder" })).toHaveCount(1);
  await page.getByRole("button", { name: "Remove folder" }).click();
  await expect(page.getByText("ros-workspace — 2 ROS packages", { exact: true })).toHaveCount(0);
});
