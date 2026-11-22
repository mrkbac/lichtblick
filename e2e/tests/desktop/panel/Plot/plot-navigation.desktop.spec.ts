// SPDX-License-Identifier: MPL-2.0

import { test } from "../../../../fixtures/electron";
import { verifyPlotNavigation } from "../../../../helpers/plot-navigation";

test("seeks, zooms, pans, and resets a Plot", { tag: "@regression" }, async ({ mainWindow }) => {
  await verifyPlotNavigation(mainWindow);
});
