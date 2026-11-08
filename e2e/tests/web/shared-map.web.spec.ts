// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { test } from "@playwright/test";

import { exerciseSharedMap } from "../../helpers/shared-map";

test("renders sharp vectors and picks the shared 3D scene", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/");
  await exerciseSharedMap(page);
});
