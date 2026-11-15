// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const compare = {
  // Panel toolbar picker
  showRecordings: "Recordings this panel shows",
  show: "Show",
  followShort: "auto",
  followLayout: "Same as layout ({{side}})",
  followHint: "{{key}} switches every following panel",
  allSides: "All recordings",
  allSidesNative: "Drawn together in this panel",
  layout: "Layout",
  layout_split: "Side by side",
  layoutHint_split: "One copy of the panel per recording",
  layout_swipe: "Swipe",
  layoutHint_swipe: "Drag the divider to reveal the second recording",
  layout_blend: "Blend",
  layoutHint_blend: "Fade between two recordings",
  layout_difference: "Difference",
  layoutHint_difference: "Bright where two recordings differ",

  // Data source sidebar
  recordings: "Compared recordings",
  offsetsHint:
    "All recordings start together. Move one along the timeline to line up the same moment in each.",
  offset: "Offset",
  nudge: "Move by {{step}} s",
  startAtPlayhead: "Start at the playhead",
  endAtPlayhead: "End at the playhead",
  resetOffset: "Reset offset",

  // Compare dialog
  dialogTitle: "Compare recordings",
  dialogHint:
    "Each row is one recording, shown under its own topic prefix (/a, /b, …) with all starting together. Put several files in a row to merge them into that recording.",
  shared: "In every recording",
  sharedHint: "Added to each row, e.g. a base recording the rows add their own topics to",
  sharedEmpty: "Optional",
  sideName: "Recording {{label}}",
  sideNameLabel: "Recording name",
  sideEmpty: "Drop files here",
  addFiles: "Add files",
  addRecording: "Add recording",
  addRecordings: "Add files as recordings…",
  addRecordingsHint: "Each picked file becomes a recording of its own",
  removeRecording: "Remove recording",
  mixedTypes: "All files must be of a type one data source reads.",
  cancel: "Cancel",
  compare: "Compare",
  compareCount: "Compare {{count}} recordings",
};
