// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { test, expect } from "../../../fixtures/electron";
import { AppMenu, DataSourceDialog } from "../../../page-objects";

/**
 * GIVEN the app is on the initial screen
 * WHEN the user opens File > Open...
 * AND the user clicks the connection type button next to the address bar
 * THEN the connection types should be listed
 */
test("List connection types on the start page opened via File > Open...", {
  tag: "@smoke",
}, async ({ mainWindow }) => {
  const dialog = new DataSourceDialog(mainWindow);
  const appMenu = new AppMenu(mainWindow);

  // Given
  await dialog.close();

  // When
  await appMenu.openFile();
  await dialog.openConnectionTypeMenu();

  // Then
  await expect(mainWindow.getByRole("menuitem", { name: "Detect from URL" })).toBeVisible();
  await expect(mainWindow.getByRole("menuitem", { name: "Rosbridge" })).toBeVisible();
});
