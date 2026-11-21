// SPDX-License-Identifier: MPL-2.0

import { test } from "@playwright/test";

import { exerciseSharedMap } from "../../helpers/shared-map";

test("renders sharp vectors and picks the shared 3D scene", { tag: "@smoke" }, async ({ page }) => {
  // Software WebGPU and WebGL in CI need more time for the projection and zoom round trips
  test.setTimeout(180_000);
  await page.goto("/");
  await exerciseSharedMap(page);
});
