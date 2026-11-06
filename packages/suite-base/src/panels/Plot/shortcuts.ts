// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/** Bound by the panel (global, acting on the hovered plot) from this list. */
export const PLOT_SHORTCUTS = [
  { id: "plot.zoomY", titleKey: "zoomYOnly", keys: [{ key: "v" }] },
  { id: "plot.zoomXY", titleKey: "zoomBothAxes", keys: [{ key: "b" }] },
  { id: "plot.resetView", titleKey: "resetView", keys: [{ key: "r" }] },
  { id: "plot.boxZoom", titleKey: "toggleBoxZoom", keys: [{ key: "z" }] },
  { id: "plot.cancel", titleKey: "cancelPlotTool", keys: [{ key: "Escape" }] },
] as const satisfies readonly KeyboardShortcut[];
