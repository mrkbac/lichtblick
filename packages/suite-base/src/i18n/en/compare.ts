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
    "Each row is one recording. Its topics get their own prefix (/a, /b, …) and all recordings start at the same moment. Several files in one row are merged into one recording.",
  shared: "Added to every recording",
  sharedHint: "For data every recording needs but doesn't contain, e.g. a map or calibration file",
  sharedEmpty: "Optional",
  sideName: "Recording {{label}}",
  sideNameLabel: "Recording name",
  sideEmpty: "Drop files here",
  addFiles: "Local files",
  addFrom: "URL, recent or catalog",
  addFromHint:
    "Pick a recording the way you'd open one: a recent, a URL, the catalog or the samples",
  pickBanner: "Pick a recording to add to {{label}} in the comparison.",
  sharedPick: "every recording",
  pickCancel: "Back to the comparison",
  notComparable:
    "{{name}} can't be compared. Comparing works with {{types}} recordings, local or remote.",
  thisSource: "This source",
  cookiesConflict:
    "{{name}} is already in the comparison with a different cookie setting. Remove it first to add it this way.",
  cookiesMixed:
    "Recordings opened with cookies (signed-in links) can only be compared with other remote recordings that also use cookies.",
  addRecording: "Add recording",
  addRecordings: "Add several files, one row each…",
  addRecordingsHint: "Each picked file becomes a recording of its own",
  removeRecording: "Remove recording",
  mixedTypes:
    "Some of these can't be compared. Comparing works with {{types}} recordings, local or remote.",
  cancel: "Cancel",
  compare: "Compare",
  compareCount: "Compare {{count}} recordings",
};
