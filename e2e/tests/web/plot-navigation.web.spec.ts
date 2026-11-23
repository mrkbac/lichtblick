// SPDX-License-Identifier: MPL-2.0

import { test } from "@playwright/test";

import { verifyPlotNavigation } from "../../helpers/plot-navigation";

test("seeks, zooms, pans, and resets a Plot", { tag: "@regression" }, async ({ page }) => {
  await page.goto("/");
  await verifyPlotNavigation(page);
});
