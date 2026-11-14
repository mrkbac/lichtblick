// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** App-wide shortcuts. Handlers live with the feature (Workspace, CommandPalette, Panel, …). */
export const APP_SHORTCUTS = [
  {
    id: "app.commandPalette",
    titleKey: "commandPalette",
    keys: [{ key: "k", mod: true, shift: false, alt: false }],
  },
  { id: "app.showShortcuts", titleKey: "showShortcuts", keys: [{ key: "?" }] },
  { id: "app.openFile", titleKey: "openFile", keys: [{ key: "o", mod: true, shift: false }] },
  {
    id: "app.openConnection",
    titleKey: "openConnection",
    keys: [{ key: "o", mod: true, shift: true }],
  },
  { id: "app.toggleLeftSidebar", titleKey: "toggleLeftSidebar", keys: [{ key: "[" }] },
  { id: "app.toggleRightSidebar", titleKey: "toggleRightSidebar", keys: [{ key: "]" }] },
  { id: "app.togglePanelSettings", titleKey: "togglePanelSettings", keys: [{ key: "," }] },
  { id: "app.selectAllPanels", titleKey: "selectAllPanels", keys: [{ key: "a", mod: true }] },
  // Display only: hold-to-show, handled by key down/up pairs in Panel
  { id: "app.panelQuickActions", titleKey: "panelQuickActions", keys: [{ key: "`" }] },
  { id: "app.exitFullscreen", titleKey: "exitFullscreen", keys: [{ key: "Escape" }] },
  // Only while recordings are compared: panels following the layout switch to the next recording
  { id: "app.nextCompareSide", titleKey: "nextCompareSide", keys: [{ key: "c" }] },
] as const satisfies readonly KeyboardShortcut[];

export const PLAYBACK_SHORTCUTS = [
  { id: "playback.playPause", titleKey: "playPause", keys: [{ key: " " }] },
  // Shift/Alt are left open: the step handler reads them to pick the step size.
  { id: "playback.stepBackward", titleKey: "stepBackward", keys: [{ key: "ArrowLeft" }] },
  { id: "playback.stepForward", titleKey: "stepForward", keys: [{ key: "ArrowRight" }] },
  // Display only: the step shortcuts above cover these.
  {
    id: "playback.stepSmall",
    titleKey: "stepSmall",
    keys: [
      { key: "ArrowLeft", shift: true },
      { key: "ArrowRight", shift: true },
    ],
  },
  {
    id: "playback.stepBig",
    titleKey: "stepBig",
    keys: [
      { key: "ArrowLeft", alt: true },
      { key: "ArrowRight", alt: true },
    ],
  },
  { id: "playback.seekStart", titleKey: "seekStart", keys: [{ key: "Home" }] },
  { id: "playback.seekEnd", titleKey: "seekEnd", keys: [{ key: "End" }] },
  { id: "playback.trimIn", titleKey: "trimIn", keys: [{ key: "i" }] },
  { id: "playback.trimOut", titleKey: "trimOut", keys: [{ key: "o" }] },
] as const satisfies readonly KeyboardShortcut[];
