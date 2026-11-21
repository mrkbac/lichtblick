// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "../../../fixtures/electron";
import { exerciseSharedMap } from "../../../helpers/shared-map";

test("renders sharp vectors and picks the shared 3D scene", { tag: "@smoke" }, async ({
  electronApp,
  mainWindow,
}) => {
  // Software WebGPU and WebGL in CI need more time for the projection and extreme-zoom round trips.
  test.setTimeout(180_000);
  await expect(mainWindow.getByTestId("DataSourceDialog")).toBeVisible();
  await mainWindow.keyboard.press("Escape");
  await expect(mainWindow.getByTestId("DataSourceDialog")).toBeHidden();
  // Electron's own capture of the composited window: Playwright's screenshots under xvfb can miss
  // the WebGPU scene canvas stacked above the map's WebGL canvas
  await exerciseSharedMap(mainWindow, async (rect) => {
    const base64 = await electronApp.evaluate(async ({ BrowserWindow }, area) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage({
        x: Math.round(area.x),
        y: Math.round(area.y),
        width: Math.round(area.width),
        height: Math.round(area.height),
      });
      return image.toPNG().toString("base64");
    }, rect);
    return Buffer.from(base64, "base64");
  });
});
