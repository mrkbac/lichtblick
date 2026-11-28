// SPDX-License-Identifier: MPL-2.0

import { expect, Page, test } from "@playwright/test";

import {
  FaultProxy,
  startFaultProxy,
  startTestServer,
  TEST_TOPIC,
  TestServer,
} from "../../fixtures/live-link";
import { PlayerControls } from "../../page-objects";

/**
 * The live WebSocket player against a real server behind a proxy that breaks the link the way a
 * robot's mobile connection does: drops, a half-open link, a server restart, a slow link.
 */

let server: TestServer;
let proxy: FaultProxy;

test.beforeEach(async () => {
  server = await startTestServer();
  proxy = await startFaultProxy(server.port);
});

test.afterEach(async () => {
  await proxy.close();
  await server.close();
});

const statusPill = (page: Page) => page.getByTestId("player-status-pill");
const elapsed = (page: Page) => page.getByTestId("PlaybackTime-elapsed");

/** "H:MM:SS / H:MM:SS" → [seconds from start to current time, seconds of history] */
async function readElapsed(page: Page): Promise<[number, number]> {
  const text = (await elapsed(page).textContent()) ?? "";
  const [current, duration] = text.split("/").map((part) =>
    part
      .trim()
      .split(":")
      .reduce((sum, unit) => sum * 60 + Number(unit), 0),
  );
  return [current, duration];
}

/** Opens the connection and subscribes the Raw Messages panel to the test topic. */
async function connect(page: Page): Promise<void> {
  await page.goto(`/?ds=foxglove-websocket&ds.url=${encodeURIComponent(proxy.url)}`);
  await expect(statusPill(page)).toHaveAttribute("aria-label", "Live");
  await page.getByPlaceholder("/some/topic.msgs[0].field").fill(TEST_TOPIC);
  await expect(page.getByText(/^test\.Counter @/)).toBeVisible();
}

/** Responding to a click slower than this feels broken, on a fast or a slow link. */
const TOGGLE_BUDGET_MS = 500;

/**
 * Clicks play/pause and returns the ms until the button shows the new state, timed in the page so
 * the test runner's own round trips and actionability checks don't count.
 */
async function togglePlaybackMs(page: Page): Promise<number> {
  return await page.getByTestId("play-button").evaluate(
    async (button) =>
      await new Promise<number>((resolve) => {
        const before = button.title;
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (button.title !== before) {
            observer.disconnect();
            resolve(performance.now() - start);
          }
        });
        observer.observe(button, { attributeFilter: ["title"] });
        setTimeout(() => {
          observer.disconnect();
          resolve(Infinity);
        }, 10_000);
        button.click();
      }),
  );
}

async function expectNoAlerts(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Alerts" }).click();
  await expect(page.getByText("No alerts found")).toBeVisible();
}

async function waitForHistory(page: Page, sec: number): Promise<void> {
  await expect
    .poll(async () => (await readElapsed(page))[1], { timeout: 15_000 })
    .toBeGreaterThanOrEqual(sec);
}

test("keeps the live history and paused position across a 2 s drop", {
  tag: "@regression",
}, async ({ page }) => {
  const player = new PlayerControls(page);
  await connect(page);
  await waitForHistory(page, 3);

  await page.getByRole("button", { name: "Pause" }).click();
  const pausedAt = await player.getTimestampText();
  const [pausedElapsed, durationBefore] = await readElapsed(page);

  proxy.drop(2000);
  await expect(statusPill(page)).toHaveAttribute("aria-label", /^Reconnecting/);
  await expect(statusPill(page)).toHaveAttribute("aria-label", "Live", { timeout: 15_000 });

  // Same session: still paused at the same time, the history start didn't move, new data arrives
  expect(await player.getTimestampText()).toBe(pausedAt);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect
    .poll(async () => await readElapsed(page), { timeout: 10_000 })
    .toEqual([pausedElapsed, expect.any(Number)]);
  await expect
    .poll(async () => (await readElapsed(page))[1], { timeout: 10_000 })
    .toBeGreaterThan(durationBefore + 2);
  // Subscriptions come back in one request
  expect(server.subscribesPerConnection.at(-1)).toBe(1);
});

test("detects a half-open link and reconnects after it heals", {
  tag: "@regression",
}, async ({ page }) => {
  test.setTimeout(120_000);
  await connect(page);

  const blackholedAt = Date.now();
  proxy.blackhole();
  // Silence for 10 s, then a probe with 10 s to answer
  await expect(statusPill(page)).toHaveAttribute("aria-label", /^Reconnecting/, {
    timeout: 25_000,
  });
  const detectedAfterMs = Date.now() - blackholedAt;
  expect(detectedAfterMs).toBeGreaterThan(15_000);
  expect(detectedAfterMs).toBeLessThan(23_000);

  await page.waitForTimeout(30_000 - detectedAfterMs);
  proxy.heal();
  // Backoff is at most 15 s, plus up to 10 s for an attempt that started during the outage
  await expect(statusPill(page)).toHaveAttribute("aria-label", "Live", { timeout: 30_000 });
  await expect(page.getByText(/^test\.Counter @/)).toBeVisible();
});

test("starts over when the server restarts with a new session", {
  tag: "@regression",
}, async ({ page }) => {
  await connect(page);
  await waitForHistory(page, 4);
  await page.getByRole("button", { name: "Pause" }).click();
  const [, durationBefore] = await readElapsed(page);

  const port = server.port;
  await server.close();
  await expect(statusPill(page)).toHaveAttribute("aria-label", /^Reconnecting/);
  server = await startTestServer({ port });
  await expect(statusPill(page)).toHaveAttribute("aria-label", "Live", { timeout: 15_000 });

  // A new session: the old history is gone and playback follows live data again
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect
    .poll(async () => (await readElapsed(page))[1], { timeout: 10_000 })
    .toBeLessThan(durationBefore);
  await expect(page.getByText(/^test\.Counter @/)).toBeVisible();
  expect(server.subscribesPerConnection).toEqual([1]);
  await expectNoAlerts(page);
});

test("stays responsive on a slow link without growing memory or alerts", {
  tag: "@regression",
}, async ({ page }) => {
  test.setTimeout(120_000);
  // A short history, so its memory is full before the first sample
  await page.addInitScript(() => {
    localStorage.setItem("lichtblick.liveHistory.windowSec", "5");
  });
  await server.close();
  server = await startTestServer({ port: server.port, payloadBytes: 1000 }); // ~160 kbit/s
  proxy.shape({ latencyMs: 300, jitterMs: 100, kbps: 256 });
  await connect(page);
  await waitForHistory(page, 5);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const usedHeapMiB = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "JSHeapUsedSize")!.value / 2 ** 20;
  };
  const heapBefore = await usedHeapMiB();

  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    // A slow link is not a dead one
    await expect(statusPill(page)).toHaveAttribute("aria-label", "Live");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    const pauseMs = await togglePlaybackMs(page);
    const playMs = await togglePlaybackMs(page);
    expect(Math.max(pauseMs, playMs)).toBeLessThan(TOGGLE_BUDGET_MS);
    await page.waitForTimeout(2000);
  }

  const heapAfter = await usedHeapMiB();
  test.info().annotations.push({
    type: "heap",
    description: `${heapBefore.toFixed(1)} MiB → ${heapAfter.toFixed(1)} MiB`,
  });
  expect(heapAfter).toBeLessThan(heapBefore + 20);
  await expectNoAlerts(page);
  await expect(page.getByText(/^test\.Counter @/)).toBeVisible();
});
