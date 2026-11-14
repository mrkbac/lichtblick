// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { test, expect } from "@playwright/test";

import { loadFiles } from "../../fixtures/load-files";

/**
 * Example timestamp format: "2025-02-26 10:37:17.726 AM WET"
 * Remove timezone abbreviation for parsing
 */
function parseTimestamp(timestamp: string): number {
  const cleanTimestamp = timestamp.replace(/\s+[A-Z]{2,4}$/, "");
  return new Date(cleanTimestamp).getTime();
}

/**
 * GIVEN two Lichtblick web instances are running in different tabs
 * WHEN the same file is loaded in both instances
 * AND sync is turned on and play is clicked
 * THEN both instances should have the same timestamp
 */
test("Should sync playback between multiple web instances", { tag: "@regression" }, async ({
  browser,
}) => {
  // Create a browser context - this enables BroadcastChannel communication between tabs
  const context = await browser.newContext();

  // Create two pages (tabs) in the same context
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  try {
    // Navigate both pages to the Lichtblick web app
    await page1.goto("/");
    await page2.goto("localhost:8080");

    // Wait for both pages to load
    await page1.waitForLoadState("networkidle");
    await page2.waitForLoadState("networkidle");

    // Load the same file in both instances
    const filename = "example.mcap";

    // Load file in first tab
    await loadFiles({ mainWindow: page1, filenames: filename });
    await page1.waitForSelector('input[value*="2025-02-26"]', { timeout: 15000 });

    // Load file in second tab
    await loadFiles({ mainWindow: page2, filenames: filename });
    await page2.waitForSelector('input[value*="2025-02-26"]', { timeout: 15000 });

    const sync1 = page1.getByTestId("sync-tabs-button");
    const sync2 = page2.getByTestId("sync-tabs-button");
    const timeInput1 = page1.locator('input[value*="2025-02-26"]').first();
    const timeInput2 = page2.locator('input[value*="2025-02-26"]').first();
    const timeDiff = async () =>
      Math.abs(
        parseTimestamp(await timeInput1.inputValue()) -
          parseTimestamp(await timeInput2.inputValue()),
      );

    // Sync is available and initially off in both tabs
    await expect(sync1).toHaveAttribute("aria-pressed", "false");
    await expect(sync2).toHaveAttribute("aria-pressed", "false");

    // Enable sync in both instances
    await sync1.click();
    await sync2.click();
    await expect(sync1).toHaveAttribute("aria-pressed", "true");
    await expect(sync2).toHaveAttribute("aria-pressed", "true");

    // Both instances start at the same timestamp
    const initialTime1 = await timeInput1.inputValue();
    expect(await timeInput2.inputValue()).toBe(initialTime1);

    // Play on the first instance plays both
    await page1.getByTitle("Play", { exact: true }).click();
    await expect(page1.getByTitle("Pause", { exact: true })).toBeVisible();
    await expect(page2.getByTitle("Pause", { exact: true })).toBeVisible();
    await expect.poll(async () => await timeInput1.inputValue()).not.toBe(initialTime1);

    // Pause on the first instance pauses both at the same time (within sync propagation)
    await page1.getByTitle("Pause", { exact: true }).click();
    await expect(page1.getByTitle("Play", { exact: true })).toBeVisible();
    await expect(page2.getByTitle("Play", { exact: true })).toBeVisible();
    await expect.poll(timeDiff).toBeLessThan(100);

    // Seeking on the first instance moves both
    const pausedTime1 = await timeInput1.inputValue();
    await page1.getByTitle("Seek forward").click();
    await expect.poll(async () => await timeInput1.inputValue()).not.toBe(pausedTime1);
    await expect.poll(timeDiff).toBeLessThan(100);
  } finally {
    // Clean up
    await page1.close();
    await page2.close();
    await context.close();
  }
});
