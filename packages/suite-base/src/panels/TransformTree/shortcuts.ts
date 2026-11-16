// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Keys are bound from here by FrameRow and OffsetEditor; mouse gestures are display only. */
export const TRANSFORM_TREE_SHORTCUTS = [
  {
    id: "transformTree.adjustFrame",
    titleKey: "transformTreeAdjustFrame",
    keys: [{ key: "Enter" }, { key: " " }],
    mouse: [{ action: "click" }],
  },
  {
    id: "transformTree.closeEditor",
    titleKey: "transformTreeCloseEditor",
    keys: [{ key: "Escape" }],
  },
  {
    id: "transformTree.nudgeValue",
    titleKey: "transformTreeNudgeValue",
    keys: [{ key: "ArrowUp" }, { key: "ArrowDown" }],
    // Scrubbing is NumberInput's own
    mouse: [{ action: "drag" }],
  },
] as const satisfies readonly KeyboardShortcut[];
