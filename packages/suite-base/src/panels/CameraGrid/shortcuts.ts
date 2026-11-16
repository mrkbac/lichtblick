// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Keys are bound by the panel's onKeyDown; gestures are display only (handled by each tile). */
export const CAMERA_GRID_SHORTCUTS = [
  { id: "cameraGrid.restore", titleKey: "restoreCameraGrid", keys: [{ key: "Escape" }] },
  { id: "cameraGrid.zoom", titleKey: "cameraGridZoom", keys: [], mouse: [{ action: "scroll" }] },
  { id: "cameraGrid.pan", titleKey: "cameraGridPan", keys: [], mouse: [{ action: "drag" }] },
  {
    id: "cameraGrid.resetOrMaximize",
    titleKey: "cameraGridResetOrMaximize",
    keys: [],
    mouse: [{ action: "double-click" }],
  },
  {
    id: "cameraGrid.dropTopics",
    titleKey: "cameraGridDropTopics",
    keys: [],
    mouse: [{ action: "drop" }],
  },
] as const satisfies readonly KeyboardShortcut[];
