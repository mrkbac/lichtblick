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
    let blue = 0;
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
        if (data[i + 2] > data[i] * 2 && data[i + 2] > data[i + 1] * 2) {
          blue++;
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
      blue,
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
          world: {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [-20, -20],
                    [20, -20],
                    [20, 20],
                    [-20, 20],
                    [-20, -20],
                  ],
                ],
              },
            },
          },
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
          { id: "world", type: "fill", source: "world", paint: { "fill-color": "#000077" } },
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
  await expect(page.getByText("Map rendering", { exact: true })).toHaveCount(0);
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
  // Orthographic views keep the same context and 3D scene; the map explicitly pauses.
  const originalCanvas = await canvas.elementHandle();
  await page.getByRole("button", { name: "Switch to 2D camera", exact: true }).click();
  await expect(
    page.getByText("Map is hidden in orthographic view. Switch to perspective to show it."),
  ).toBeVisible();
  await expect.poll(async () => (await pixels(canvas)).green).toBe(0);
  await expect.poll(async () => (await pixels(canvas)).red).toBeGreaterThan(100);
  expect(await originalCanvas.evaluate((element) => element.isConnected)).toBe(true);
  await page.getByRole("button", { name: /Switch to 3D camera/ }).click();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await pixels(canvas)).green).toBeGreaterThan(500);
  await expect.poll(async () => (await pixels(canvas)).red).toBeGreaterThan(100);
  await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(1);
  // Repeated zoom-out at the native limit must not consume the next inward scroll.
  await page.getByText("View", { exact: true }).click();
  const distance = page.getByRole("spinbutton").first();
  await page.mouse.move(before.x + 100, before.y);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 15000);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }
  const limit = Number(await distance.inputValue());
  expect(limit).toBeLessThan(1e9);
  const zoomedOut = (await pixels(canvas)).blue;
  expect(zoomedOut).toBeGreaterThan(100);
  await page.mouse.wheel(0, -350);
  await expect
    .poll(async () => Math.abs((await pixels(canvas)).blue - zoomedOut))
    .toBeGreaterThan(100);
  await distance.fill("100");
  await distance.press("Enter");
  await expect.poll(async () => (await pixels(canvas)).green).toBeGreaterThan(500);
  await expect.poll(async () => (await pixels(canvas)).red).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Zoom to data", exact: true }).click();
  await expect.poll(async () => Number(await distance.inputValue())).toBeLessThan(100);
  await expect.poll(async () => (await pixels(canvas)).red).toBeGreaterThan(100);
  const recovered = await pixels(canvas);
  await page.getByRole("button", { name: "Inspect objects", exact: true }).click();
  await page.mouse.click(recovered.x, recovered.y);
  await expect(page.getByText("test-cube", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
}
