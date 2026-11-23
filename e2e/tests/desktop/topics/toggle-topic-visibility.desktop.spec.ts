// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { test, expect } from "../../../fixtures/electron";
import { loadFiles } from "../../../fixtures/load-files";
import { Panels, Sidebar } from "../../../page-objects";

/**
 * GIVEN a file with multiple topics is loaded
 * WHEN the user toggles topic visibility
 * THEN the filters "All", "Shown", and "Hidden" should work as expected
 */
test("toggle topics visibility", { tag: "@smoke" }, async ({ mainWindow }) => {
  const sidebar = new Sidebar(mainWindow);

  // Given
  const filename = "demo-shuffled.bag";
  await loadFiles({
    mainWindow,
    filenames: filename,
  });

  // When
  await sidebar.openPanelSettingsTab();
  await new Panels(mainWindow).select("3D");
  const transforms = mainWindow.getByTestId("settings__nodeHeaderToggle__transforms");
  await transforms.hover();
  const transformEye = transforms.locator("..").getByRole("checkbox");
  await expect(transformEye).toBeChecked();
  await transformEye.click();
  await expect(transformEye).not.toBeChecked();

  const visibilityButtons = mainWindow
    .getByTestId(/^settings__nodeHeaderToggle__topics-/)
    .locator("..")
    .getByTitle("Toggle visibility", { exact: true });
  await expect(visibilityButtons.first()).toBeVisible();
  // Every topic the 3D panel can show is listed, all hidden; clicking the first shows it.
  const total = await visibilityButtons.count();
  expect(total).toBeGreaterThan(1);
  await visibilityButtons.first().click();

  // Then
  await expect(visibilityButtons).toHaveCount(total);

  const settings = mainWindow.getByTestId("settings-tree-editor");
  // Select only visibles
  await settings.getByRole("button", { name: "Shown", exact: true }).click();
  await expect(visibilityButtons).toHaveCount(1);

  // Select only invisibles
  await settings.getByRole("button", { name: "Hidden", exact: true }).click();
  await expect(visibilityButtons).toHaveCount(total - 1);

  // Select all
  await settings.getByRole("button", { name: "All", exact: true }).click();
  await expect(visibilityButtons).toHaveCount(total);
});
