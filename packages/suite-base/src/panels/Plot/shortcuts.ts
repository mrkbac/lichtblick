// SPDX-License-Identifier: MPL-2.0

import { KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/**
 * Keys are bound by the panel (global, acting on the hovered plot) from this list. Mouse gestures
 * are display only: handled by usePlotInteractionHandlers, usePanning, BoxZoomOverlay and
 * PlotLegendRow.
 */
export const PLOT_SHORTCUTS = [
  { id: "plot.zoom", titleKey: "plotZoom", keys: [], mouse: [{ action: "scroll" }] },
  {
    id: "plot.zoomX",
    titleKey: "plotZoomXOnly",
    keys: [],
    mouse: [{ action: "scroll", alt: true }],
  },
  {
    id: "plot.zoomY",
    titleKey: "zoomYOnly",
    keys: [{ key: "v" }],
    mouse: [{ action: "scroll", shift: true }],
  },
  {
    id: "plot.zoomXY",
    titleKey: "zoomBothAxes",
    keys: [{ key: "b" }],
    mouse: [{ action: "scroll", shift: true, alt: true }],
  },
  { id: "plot.pan", titleKey: "plotPan", keys: [], mouse: [{ action: "drag" }] },
  { id: "plot.seek", titleKey: "plotSeek", keys: [], mouse: [{ action: "click" }] },
  {
    id: "plot.resetView",
    titleKey: "resetView",
    keys: [{ key: "r" }],
    mouse: [{ action: "double-click" }],
  },
  { id: "plot.boxZoom", titleKey: "toggleBoxZoom", keys: [{ key: "z" }] },
  { id: "plot.boxZoomDrag", titleKey: "plotBoxZoomDrag", keys: [], mouse: [{ action: "drag" }] },
  {
    id: "plot.boxZoomX",
    titleKey: "plotBoxZoomX",
    keys: [],
    mouse: [{ action: "drag", alt: true }],
  },
  {
    id: "plot.boxZoomY",
    titleKey: "plotBoxZoomY",
    keys: [],
    mouse: [{ action: "drag", shift: true }],
  },
  { id: "plot.placeMarker", titleKey: "plotPlaceMarker", keys: [], mouse: [{ action: "click" }] },
  { id: "plot.cancel", titleKey: "cancelPlotTool", keys: [{ key: "Escape" }] },
  {
    id: "plot.contextMenu",
    titleKey: "plotContextMenu",
    keys: [],
    mouse: [{ action: "click", button: "right" }],
  },
  { id: "plot.editSeries", titleKey: "plotEditSeries", keys: [], mouse: [{ action: "click" }] },
  { id: "plot.dragSeries", titleKey: "plotDragSeries", keys: [], mouse: [{ action: "drag" }] },
  { id: "plot.dropPath", titleKey: "plotDropPath", keys: [], mouse: [{ action: "drop" }] },
] as const satisfies readonly KeyboardShortcut[];
