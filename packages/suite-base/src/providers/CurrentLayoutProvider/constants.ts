// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { defaultLayout } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/defaultLayout";
import { SaveNewLayout } from "@lichtblick/suite-base/services/LayoutManager/LayoutManager";
import { LAYOUT_VERSION } from "@lichtblick/suite-base/services/migrateLayout/migratePanelsState";

export const MAX_SUPPORTED_LAYOUT_VERSION = LAYOUT_VERSION;

export const ORG_PERMISSION_PREFIX = "ORG_";

export const BUSY_POLLING_INTERVAL_MS = 100;

export const BUSY_POLLING_TIMEOUT_MS = 5000;

export const FAVORITES_TIMEOUT_MS = 5000;

export const DEFAULT_LAYOUT: SaveNewLayout = {
  name: "Default",
  data: defaultLayout,
  permission: `CREATOR_WRITE`,
};
