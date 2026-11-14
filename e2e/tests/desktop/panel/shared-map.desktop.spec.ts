// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "../../../fixtures/electron";
import { exerciseSharedMap } from "../../../helpers/shared-map";

test("renders sharp vectors and picks the shared 3D scene", { tag: "@smoke" }, async ({
  mainWindow,
}) => {
  // Software WebGL in CI needs more time for the projection and extreme-zoom round trips.
  test.setTimeout(60_000);
  await expect(mainWindow.getByTestId("DataSourceDialog")).toBeVisible();
  await mainWindow.keyboard.press("Escape");
  await expect(mainWindow.getByTestId("DataSourceDialog")).toBeHidden();
  await exerciseSharedMap(mainWindow);
});
