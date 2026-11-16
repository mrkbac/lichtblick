// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/**
 * Keys are bound by MapToolbar from these declarations while a measuring tool is active; it
 * matches them in this order, so Backspace removes the last point while drawing and the selected
 * measurement otherwise. Mouse gestures are display only: handled by MapToolbar (measuring),
 * MapPanel (seek, preview, drop), and MapLibre (pan, rotate).
 */
export const MAP_SHORTCUTS = [
  // Measuring
  { id: "map.place", titleKey: "mapPlacePoint", keys: [], mouse: [{ action: "click" }] },
  {
    id: "map.finish",
    titleKey: "mapFinishDrawing",
    keys: [{ key: "Enter" }],
    mouse: [{ action: "double-click" }],
  },
  { id: "map.cancel", titleKey: "mapCancelDrawing", keys: [{ key: "Escape" }] },
  { id: "map.closeArea", titleKey: "mapCloseArea", keys: [], mouse: [{ action: "click" }] },
  {
    id: "map.selectMeasurement",
    titleKey: "mapSelectMeasurement",
    keys: [],
    mouse: [{ action: "click" }],
  },
  { id: "map.movePoint", titleKey: "mapMovePoint", keys: [], mouse: [{ action: "drag" }] },
  {
    id: "map.insertPoint",
    titleKey: "mapInsertPoint",
    keys: [],
    mouse: [{ action: "click" }, { action: "drag" }],
  },
  {
    id: "map.deletePoint",
    titleKey: "mapDeletePoint",
    keys: [],
    mouse: [
      { action: "click", button: "right" },
      { action: "click", alt: true },
    ],
  },
  { id: "map.deleteLastPoint", titleKey: "mapDeleteLastPoint", keys: [{ key: "Backspace" }] },
  {
    id: "map.deleteMeasurement",
    titleKey: "mapDeleteMeasurement",
    keys: [{ key: "Delete" }, { key: "Backspace" }],
  },
  // Map
  { id: "map.preview", titleKey: "mapPreviewPoint", keys: [], mouse: [{ action: "hover" }] },
  { id: "map.seek", titleKey: "mapSeekToPoint", keys: [], mouse: [{ action: "click" }] },
  { id: "map.pan", titleKey: "mapPan", keys: [], mouse: [{ action: "drag" }] },
  {
    id: "map.rotate",
    titleKey: "mapRotateTilt",
    keys: [],
    mouse: [
      { action: "drag", button: "right" },
      { action: "drag", ctrl: true },
    ],
  },
  { id: "map.dropTopic", titleKey: "mapDropTopic", keys: [], mouse: [{ action: "drop" }] },
  {
    id: "map.copyCoordinates",
    titleKey: "mapCopyCoordinates",
    keys: [],
    mouse: [{ action: "click" }],
  },
] as const satisfies readonly KeyboardShortcut[];
