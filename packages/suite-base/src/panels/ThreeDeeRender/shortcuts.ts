// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

const ARROWS = [
  { key: "ArrowUp" },
  { key: "ArrowDown" },
  { key: "ArrowLeft" },
  { key: "ArrowRight" },
] as const;

/**
 * The perspective toggle is bound from this list. The rest is handled by renderables (orbit
 * controls, FrameAxes, MeasurementTool) and declared here for display only.
 */
export const THREE_DEE_SHORTCUTS = [
  { id: "3d.togglePerspective", titleKey: "togglePerspective", keys: [{ key: "3" }] },
  {
    id: "3d.moveCamera",
    titleKey: "moveCamera",
    keys: [{ key: "w" }, { key: "a" }, { key: "s" }, { key: "d" }],
  },
  { id: "3d.screenSpacePan", titleKey: "screenSpacePan", keys: [{ key: "Alt" }] },
  { id: "3d.toggleOriginal", titleKey: "toggleOriginalTransforms", keys: [{ key: "o" }] },
  { id: "3d.undoOffset", titleKey: "undoTransformOffset", keys: [{ key: "z", mod: true }] },
  {
    id: "3d.nudgeFrame",
    titleKey: "nudgeFrame",
    keys: [...ARROWS, { key: "PageUp" }, { key: "PageDown" }],
  },
  { id: "3d.finishMeasurement", titleKey: "finishMeasurement", keys: [{ key: "Escape" }] },
  {
    id: "3d.deleteMeasurement",
    titleKey: "deleteMeasurement",
    keys: [{ key: "Backspace" }, { key: "Delete" }],
  },
] as const satisfies readonly KeyboardShortcut[];
