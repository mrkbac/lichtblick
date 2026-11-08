// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, Locator, Page } from "@playwright/test";

import { loadFiles } from "../fixtures/load-files";

async function pixels(canvas: Locator) {
  return await canvas.evaluate((element: HTMLCanvasElement) => {
    const gl = element.getContext("webgl2")!;
    const { width, height } = element;
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let red = 0;
    let green = 0;
    let redX = 0;
    let redY = 0;
    let lineWidth = 0;
    const column = Math.floor(width * 0.75);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) {
          red++;
          redX += x;
          redY += y;
        }
        if (data[i + 1] > data[i] * 2 && data[i + 1] > data[i + 2] * 2) {
          green++;
          if (x === column) {
            lineWidth++;
          }
        }
      }
    }
    const rect = element.getBoundingClientRect();
    return {
      red,
      green,
      lineWidth: (lineWidth * rect.height) / height,
      x: rect.x + ((redX / Math.max(1, red)) * rect.width) / width,
      y: rect.y + ((height - redY / Math.max(1, red)) * rect.height) / height,
      width,
      height,
    };
  });
}

/** Offline fixture: a red 3D cube at the GPS fix on a green vector road. */
export async function exerciseSharedMap(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://shared-map.test/style.json", async (route) => {
    await route.fulfill({
      json: {
        version: 8,
        glyphs: "https://shared-map.test/{fontstack}/{range}.pbf",
        sources: {
          road: {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: [
                  [10.995, 48],
                  [11.005, 48],
                ],
              },
            },
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#e0f0e0" } },
          {
            id: "road",
            type: "line",
            source: "road",
            paint: { "line-color": "#007700", "line-width": 12 },
          },
        ],
      },
    });
  });
  await loadFiles({ mainWindow: page, filenames: "shared-map-layout.json" });
  const canvas = page
    .getByTestId("panel-mouseenter-container 3D!shared")
    .locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();
  await loadFiles({ mainWindow: page, filenames: "shared-map.mcap" });
  await expect.poll(async () => (await pixels(canvas)).red).toBeGreaterThan(100);
  await expect.poll(async () => (await pixels(canvas)).green).toBeGreaterThan(500);
  const before = await pixels(canvas);
  expect(before.lineWidth).toBeGreaterThan(5);
  expect(before.lineWidth).toBeLessThan(20);
  await page.mouse.move(before.x + 100, before.y);
  await page.mouse.wheel(0, -350);
  await expect.poll(async () => (await pixels(canvas)).red).toBeGreaterThan(before.red * 1.2);
  const after = await pixels(canvas);
  expect(after.lineWidth).toBeGreaterThan(5);
  expect(after.lineWidth).toBeLessThan(20);
  expect(Math.abs(after.lineWidth - before.lineWidth)).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "Inspect objects", exact: true }).click();
  await page.mouse.click(after.x, after.y);
  await expect(page.getByText("test-cube", { exact: true }).first()).toBeVisible();
  // Switching projections must recreate the context without losing the selected map settings.
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(canvas).toHaveCount(0);
  expect(errors).toEqual([]);
  const ordinary = page
    .getByTestId("panel-mouseenter-container 3D!shared")
    .locator("canvas:visible");
  await expect(ordinary).toHaveCount(1);
  await ordinary.press("3");
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await pixels(canvas)).red).toBeGreaterThan(100);
  expect(errors).toEqual([]);
}
