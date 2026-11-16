// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const watch = {
  // Panel
  emptyTitle: "Watch many values in one table",
  emptyHint:
    "Add a message path below, paste several paths (one per line) or drag fields from the topic list.",
  addPlaceholder: "Add message path…",
  openInPlot: "Open in Plot",
  copied: "Copied",
  expand: "Expand",
  collapse: "Collapse",
  invalidPath: "Invalid message path",
  addedRows: "Added {{count}} rows",
  ageTooltip: "Time since the message with this value",
  staleTooltip: "No update for {{age}}",

  // Settings
  general: "General",
  sparklines: "Sparklines",
  showAge: "Show value age",
  flashChanges: "Flash on change",
  staleAfter: "Stale after (s)",
  staleAfterHelp: "Values that haven't updated for longer are dimmed and marked.",
  sparklinesHelp: "Draws a small chart of each numeric row's recent values.",
  flashChangesHelp: "Briefly highlights a row when its value changes.",
  showAgeHelp: "Shows how long ago each value's message arrived.",
  rows: "Rows",
  rowsHelp: "The watched values, in display order.",
  pathHelp: "Message path of the value, with filters and math modifiers.",
  labelHelp: "Name shown instead of the path.",
  precisionHelp: "Fixed number of decimals; automatic when empty.",
  unitHelp: "Text shown after the value.",
  rowStaleAfterHelp: "Overrides the panel's stale time for this row.",
  addRow: "Add row",
  duplicate: "Duplicate",
  remove: "Remove",
  path: "Message path",
  label: "Label",
  precision: "Decimals",
  auto: "Auto",
  unit: "Unit",
};
