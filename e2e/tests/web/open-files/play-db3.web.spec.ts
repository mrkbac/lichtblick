// SPDX-License-Identifier: MPL-2.0

import { test } from "@playwright/test";

import { verifyDb3Playback } from "../../../helpers/db3-playback";

for (const mode of ["single-file", "split"] as const) {
  test(
    `plays and seeks a ${mode} ROS 2 DB3 bag`,
    {
      tag: "@regression",
    },
    async ({ page }, testInfo) => {
      await page.goto("/");
      await verifyDb3Playback(page, testInfo, mode);
    },
  );
}
