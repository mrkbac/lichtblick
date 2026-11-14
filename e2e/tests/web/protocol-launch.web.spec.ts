// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { expect, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

type TestWindow = Window & {
  consumeLaunch?: (params: { files: FileSystemHandle[]; targetURL: string }) => Promise<void>;
};

// The browser hands launches to the app's launchQueue consumer; keep it so tests can launch.
const stubLaunchQueue = async (page: Page) => {
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
};

const callback = (query: string) =>
  `/?protocol=${encodeURIComponent(`web+lichtblick://open?${query}`)}`;

test("routes cold and existing PWA protocol launches without reloading", { tag: "@smoke" }, async ({
  page,
}) => {
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
  // Generated JSON messages { value: 1..3 } on /example at seconds 1..3; no recorded data.
  const data = await readFile(path.resolve("e2e/fixtures/assets/protocol-example.mcap"));
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
  await stubLaunchQueue(page);
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
  }, callback("time=2"));
  await expect(page).toHaveURL(/[?&]time=1970-01-01T00(?::|%3A)00(?::|%3A)02/);
  await expect(page.locator("body")).toHaveAttribute("data-launch-marker", "same-workspace");
  await expect(play).toBeEnabled();

  // A second source launch also reuses the current workspace.
  await page.evaluate(async (target) => {
    await (window as TestWindow).consumeLaunch!({ files: [], targetURL: location.origin + target });
  }, callback("ds=remote-file&ds.url=http%3A%2F%2Flocalhost%3A8080%2Fprotocol-example.mcap"));
  await expect(play).toBeEnabled();
  await expect(page.locator("body")).toHaveAttribute("data-launch-marker", "same-workspace");
});

test("opens .mcap and .bag files launched through the PWA file handlers", {
  tag: "@regression",
}, async ({ page }) => {
  const manifest = (await (await page.request.get("/manifest.webmanifest")).json()) as {
    file_handlers: { action: string; accept: Record<string, string[]> }[];
  };
  const extensions = manifest.file_handlers.flatMap((handler) =>
    Object.values(handler.accept).flat(),
  );
  expect(extensions).toEqual(expect.arrayContaining([".mcap", ".bag"]));
  expect(manifest.file_handlers.every((handler) => handler.action === ".")).toBe(true);

  for (const name of ["example.mcap", "example.bag"]) {
    const data = await readFile(path.resolve("e2e/fixtures/assets", name));
    await page.route(`**/launched/${name}`, async (route) => {
      await route.fulfill({ body: data });
    });
  }
  await stubLaunchQueue(page);
  await page.goto("/");
  await expect.poll(async () => await page.evaluate(() => "consumeLaunch" in window)).toBe(true);

  const launchFile = async (name: string) => {
    await page.evaluate(async (fileName) => {
      // Launches carry real file handles, which the app keeps in recents and asks for permission.
      const blob = await (await fetch(`/launched/${fileName}`)).blob();
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      await (window as TestWindow).consumeLaunch!({
        files: [handle],
        targetURL: location.origin + "/",
      });
    }, name);
  };

  const play = page.getByRole("button", { name: "Play", exact: true });
  await launchFile("example.mcap");
  await expect(play).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText("example.mcap").first()).toBeVisible();

  // A second launch replaces the open recording
  await launchFile("example.bag");
  await expect(page.getByText("example.bag").first()).toBeVisible({ timeout: 30_000 });
  await expect(play).toBeEnabled();
});
