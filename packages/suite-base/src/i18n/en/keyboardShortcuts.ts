// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const keyboardShortcuts = {
  // Overlay
  title: "Keyboard shortcuts",
  searchPlaceholder: "Search by action or key",
  noResults: "No shortcuts match",
  groupApp: "App",
  groupPlayback: "Playback",
  groupLayout: "Layout",

  // App
  commandPalette: "Open command palette",
  openFile: "Open local file",
  openConnection: "Open connection",
  toggleLeftSidebar: "Toggle left sidebar",
  toggleRightSidebar: "Toggle right sidebar",
  togglePanelSettings: "Toggle panel settings",
  showShortcuts: "Show keyboard shortcuts",
  selectAllPanels: "Select all panels",
  panelQuickActions: "Show panel quick actions (hold)",
  nextCompareSide: "Show the next compared recording",
  exitFullscreen: "Exit fullscreen panel",

  // Playback
  playPause: "Play / pause",
  stepBackward: "Step backward",
  stepForward: "Step forward",
  stepSmall: "Step by 10 ms",
  stepBig: "Step by 500 ms",
  seekStart: "Jump to start",
  seekEnd: "Jump to end",
  trimIn: "Set trim start at playhead (while trimming)",
  trimOut: "Set trim end at playhead (while trimming)",

  // 3D
  togglePerspective: "Toggle 2D / 3D camera",
  moveCamera: "Move camera (canvas focused)",
  screenSpacePan: "Pan in screen space (hold while dragging)",
  toggleOriginalTransforms: "Show original transforms (with offsets)",
  undoTransformOffset: "Undo transform offset",
  nudgeFrame: "Nudge keyboard frame (hold Alt to rotate)",
  finishMeasurement: "Finish / stop measuring",
  deleteMeasurement: "Delete last point or selected measurement",

  // Plot
  zoomYOnly: "Zoom Y axis only (hold while scrolling)",
  zoomBothAxes: "Zoom both axes (hold while scrolling)",
  resetView: "Reset view of hovered plot",
  toggleBoxZoom: "Toggle box zoom of hovered plot",
  cancelPlotTool: "Exit box zoom / measure mode",

  // State Transitions
  nextMatch: "Jump to next condition match",
  previousMatch: "Jump to previous condition match",
  exitMeasureMode: "Exit measure mode",

  // Teleop (panel focused)
  teleopDrive: "Drive (left stick)",
  teleopTurn: "Turn (right stick)",
  teleopTurbo: "Turbo (hold)",
  teleopStop: "Emergency stop",
  teleopSpeed: "Increase / decrease speed",

  // Other panels
  restoreCameraGrid: "Restore grid from maximized camera",
  searchMessage: "Search in message",
  finishDrawing: "Finish drawing",
  cancelDrawing: "Finish line, deselect or exit tool",
  deleteDrawingPoint: "Delete last point or selected drawing",
  finishNote: "Leave notes editor",
  publishMessage: "Publish message",
  callService: "Call service",
};
