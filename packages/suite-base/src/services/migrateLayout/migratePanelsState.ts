// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MarkOptional } from "ts-essentials";

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { normalizeTabs } from "@lichtblick/suite-base/util/tabLayout";

import { migrateLegacyToNew3DPanels } from "./migrateLegacyToNew3DPanels";
import { migrateLegacyToNewImagePanels } from "./migrateLegacyToNewImagePanels";
import { migrateMosaicLayout } from "./migrateMosaicLayout";

/**
 * Layout data version written by this app. Version 2 stores the layout as a tree of tab groups
 * (`LayoutNode`); older apps refuse to open it instead of misreading it.
 */
export const LAYOUT_VERSION = 2;

/**
 * Perform any necessary migrations on old layout data.
 */
export function migratePanelsState(data: MarkOptional<LayoutData, "configById">): LayoutData {
  let result: LayoutData = { ...data, configById: data.configById ?? {} };
  // A newer app wrote this layout: the legacy migrations could drop content they don't recognize.
  if ((result.version ?? 0) > LAYOUT_VERSION) {
    return result;
  }

  result = migrateMosaicLayout(result);
  result = migrateLegacyToNew3DPanels(result);
  result = migrateLegacyToNewImagePanels(result);
  // Panels stacked into one group are shown as a Tab panel.
  result = normalizeTabs(result);
  result.version = Math.max(result.version ?? 0, LAYOUT_VERSION);

  return result;
}
