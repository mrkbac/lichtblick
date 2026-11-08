// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { test } from "../../../fixtures/electron";
import { exerciseSharedMap } from "../../../helpers/shared-map";

// SwiftShader's WebGL2 backend is unavailable in the macOS Electron build.
test.use({ electronArgs: process.platform === "darwin" ? ["--use-angle=metal"] : [] });

test("renders sharp vectors and picks the shared 3D scene", { tag: "@smoke" }, async ({
  mainWindow,
}) => {
  await exerciseSharedMap(mainWindow);
});
