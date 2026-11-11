// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { test, expect } from "../../../fixtures/electron";
import { loadFromFilePicker } from "../../../fixtures/load-from-file-picker";
import { DataSourceDialog, LayoutManager, Sidebar } from "../../../page-objects";

const LAYOUT_FILE = "tab-layout.json";

/**
 * GIVEN the user is on the Layouts tab and a layout with a two-tab Tab panel is loaded
 * THEN both tabs are visible
 * WHEN a new tab is added from the Tab panel's "New tab" button
 * THEN the Tab panel shows three tabs and the new one is selected
 * WHEN two tabs are closed
 * THEN the Tab panel turns back into the remaining tab's panel
 */
test("load a tab layout and add a tab", { tag: "@regression" }, async ({ mainWindow }) => {
  const dialog = new DataSourceDialog(mainWindow);
  const sidebar = new Sidebar(mainWindow);
  const layout = new LayoutManager(mainWindow);
  const tabs = mainWindow.getByTestId("tab-panel-tab");

  // Given
  await dialog.close();
  await sidebar.openLayoutsTab();
  await loadFromFilePicker(mainWindow, LAYOUT_FILE);
  await layout.importLayout();

  // Then
  await expect(tabs).toHaveCount(2);

  // When
  await mainWindow.getByTestId("add-tab").click();
  await mainWindow.getByTestId("panel-menu-item Raw Messages").click();

  // Then
  await expect(tabs).toHaveCount(3);
  await expect(mainWindow.getByRole("tab", { name: "Raw Messages" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // When
  // Close buttons show on hover and sit inside role="tab", outside the accessibility tree.
  for (const title of ["1", "2"]) {
    await tabs.filter({ hasText: title }).first().hover();
    await mainWindow.getByLabel(`Close ${title}`, { exact: true }).click();
  }

  // Then
  await expect(tabs).toHaveCount(0);
  await expect(mainWindow.getByTestId(/^panel-mouseenter-container RawMessages!/)).toBeVisible();
});
