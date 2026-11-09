// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

type TestWindow = Window & {
  consumeLaunch?: (params: { files: FileSystemHandle[]; targetURL: string }) => Promise<void>;
};

const callback = (query: string) =>
  `/?protocol=${encodeURIComponent(`web+lichtblick://open?${query}`)}`;

test("routes cold and existing PWA protocol launches without reloading", async ({ page }) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  const manifest = (await manifestResponse.json()) as {
    protocol_handlers: { protocol: string; url: string }[];
    launch_handler: { client_mode: string };
    file_handlers: unknown[];
  };
  expect(manifest.protocol_handlers).toEqual([
    { protocol: "web+lichtblick", url: "./?protocol=%s" },
  ]);
  expect(manifest.launch_handler.client_mode).toBe("focus-existing");
  expect(manifest.file_handlers).toHaveLength(3);
  const data = await readFile(path.resolve("e2e/fixtures/assets/example.mcap"));
  await page.route("**/protocol-example.mcap", async (route) => {
    const range = (await route.request().headerValue("range"))?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : data.length - 1;
    await route.fulfill({
      status: range ? 206 : 200,
      body: data.subarray(start, end + 1),
      headers: {
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
      },
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer: (consumer: TestWindow["consumeLaunch"]) => {
          (window as TestWindow).consumeLaunch = consumer;
        },
      },
    });
  });
  await page.goto(
    callback("ds=remote-file&ds.url=http%3A%2F%2Flocalhost%3A8080%2Fprotocol-example.mcap"),
  );
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeEnabled({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/protocol=/);
  await page.evaluate(() => {
    document.body.dataset.launchMarker = "same-workspace";
  });

  // A normal launch and an untrusted callback must preserve the loaded recording.
  await page.evaluate(async () => {
    const consume = (window as TestWindow).consumeLaunch!;
    await consume({ files: [], targetURL: location.origin + "/" });
    await consume({ files: [], targetURL: "https://untrusted.example/?protocol=bad" });
  });
  await expect(play).toBeEnabled();
  await page.evaluate(async (target) => {
    await (window as TestWindow).consumeLaunch!({ files: [], targetURL: location.origin + target });
  }, callback("time=1740566236"));
  await expect(page).toHaveURL(/[?&]time=2025-02-26T10%3A37%3A16|[?&]time=2025-02-26T10:37:16/);
  await expect(page.locator("body")).toHaveAttribute("data-launch-marker", "same-workspace");
  await expect(play).toBeEnabled();

  // A second source launch also reuses the current workspace.
  await page.evaluate(async (target) => {
    await (window as TestWindow).consumeLaunch!({ files: [], targetURL: location.origin + target });
  }, callback("ds=remote-file&ds.url=http%3A%2F%2Flocalhost%3A8080%2Fprotocol-example.mcap"));
  await expect(play).toBeEnabled();
  await expect(page.locator("body")).toHaveAttribute("data-launch-marker", "same-workspace");
});
