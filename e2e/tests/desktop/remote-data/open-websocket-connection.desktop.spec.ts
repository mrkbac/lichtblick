// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { test, expect } from "../../../fixtures/electron";
import { launchWebsocket } from "../../../fixtures/launch-websocket";
import { DataSourceDialog, Panels, Sidebar } from "../../../page-objects";

/**
 * GIVEN there is a WebSocket server is running
 * WHEN the user opens ws://localhost:8765 from the start page's address bar
 * THEN the address ws://localhost:8765 should be visible
 * WHEN the user clicks on the "Topics" tab
 * THEN the topic "/websocket_test" should appear in the list
 * AND data should be correctly displayed in the "Raw Messages" panel
 */
test("show correctly open a web socket connection showing correct attibutes on raw messages panel", {
  tag: "@regression",
}, async ({ mainWindow }) => {
  const dialog = new DataSourceDialog(mainWindow);
  const sidebar = new Sidebar(mainWindow);
  const panels = new Panels(mainWindow);

  // Given
  const websocketServer = launchWebsocket();

  try {
    // When
    await dialog.connect("ws://localhost:8765");

    // Then
    await expect(mainWindow.getByText("ws://localhost:8765").innerHTML()).resolves.toBeDefined();

    // When
    await sidebar.openTopicsTab();
    await expect(mainWindow.getByText("/websocket_test").innerHTML()).resolves.toBeDefined();
    await panels.addPanel("Raw Messages");

    // The default layout's Raw Messages panel may sit in a hidden tab; use the visible one.
    const rawMessagesPanel = mainWindow.getByTestId(/RawMessages!/).first();
    await rawMessagesPanel.getByPlaceholder("/some/topic.msgs[0].field").click();
    await mainWindow.getByTestId("autocomplete-item").click();

    await rawMessagesPanel.getByRole("button", { name: "Expand data", exact: true }).click();
    const attributesToCheck = ["hello", '"world"', "foo", "42"];

    // Then
    for (const attribute of attributesToCheck) {
      await expect(
        rawMessagesPanel.getByText(attribute, { exact: true }).innerText(),
      ).resolves.toBe(attribute);
    }
  } finally {
    await websocketServer.close();
  }
});
