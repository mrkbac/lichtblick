// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Display only: handled by the panel's onKeyDown. */
export const CAMERA_GRID_SHORTCUTS = [
  { id: "cameraGrid.restore", titleKey: "restoreCameraGrid", keys: [{ key: "Escape" }] },
] as const satisfies readonly KeyboardShortcut[];
