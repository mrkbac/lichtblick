// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Escape is bound by the panel's onKeyDown, the other keys by the focused tile's; gestures are display only. */
export const CAMERA_GRID_SHORTCUTS = [
  { id: "cameraGrid.restore", titleKey: "restoreCameraGrid", keys: [{ key: "Escape" }] },
  { id: "cameraGrid.zoom", titleKey: "cameraGridZoom", keys: [], mouse: [{ action: "scroll" }] },
  { id: "cameraGrid.zoomIn", titleKey: "cameraGridZoomIn", keys: [{ key: "+" }, { key: "=" }] },
  { id: "cameraGrid.zoomOut", titleKey: "cameraGridZoomOut", keys: [{ key: "-" }] },
  {
    id: "cameraGrid.pan",
    titleKey: "cameraGridPan",
    // Shift/Alt+arrows stay playback shortcuts
    keys: (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const).map((key) => ({
      key,
      shift: false,
      alt: false,
    })),
    mouse: [{ action: "drag" }],
  },
  {
    id: "cameraGrid.resetOrMaximize",
    titleKey: "cameraGridResetOrMaximize",
    keys: [{ key: "Enter" }],
    mouse: [{ action: "double-click" }],
  },
  {
    id: "cameraGrid.dropTopics",
    titleKey: "cameraGridDropTopics",
    keys: [],
    mouse: [{ action: "drop" }],
  },
] as const satisfies readonly KeyboardShortcut[];
