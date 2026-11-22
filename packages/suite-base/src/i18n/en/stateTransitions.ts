// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const stateTransitions = {
  addSeriesButton: "Click to add a series",
  dragSeriesHint: "Drag onto another panel to add this series",
  conditionErrorMessage: 'Use one comparison, e.g. > 2 or == "ERROR"',
  delta: "Delta",
  labels: {
    addSeries: "Add series",
    axisLabel: "Axis label",
    axisLabelHelp: "Text shown under the time axis. Leave empty to hide it.",
    condition: "Condition",
    conditionHelp:
      'Optional comparison against the value, e.g. > 2, == "ERROR" or != true. The series then shows when it is true.',
    deleteSeries: "Delete series",
    general: "General",
    helpGeneral: "Display a point for every state transition message",
    label: "Label",
    labelHelp: "Name shown in the legend instead of the message path.",
    messagePath: "Message path",
    messagePathHelp: "The value to show. Each distinct value gets its own color.",
    series: "Series",
    showPoints: "Show points",
    sync: "Sync with other plots",
    syncHelp: "Zooms and pans together with other synced plots.",
    timestamp: "Timestamp",
    timestampHelp: "Places messages by receive time or by their header stamp.",
    timestampHeaderStamp: "Header Stamp",
    timestampReceiveTime: "Receive Time",
  },
  markerA: "P1",
  markerB: "P2",
  matchesApproximate: "Older history was thinned. The count and match navigation may miss matches.",
  max: "Max",
  maxHelp: "Fixed end of the time axis, in seconds from the start. Clears the range.",
  maxXError: "X max must be greater than X min.",
  min: "Min",
  minHelp: "Fixed start of the time axis, in seconds from the start. Clears the range.",
  pathErrorMessage: "This path resolves to more than one value",
  secondsRange: "Range (seconds)",
  secondsRangeHelp: "Shows only the last N seconds up to the playhead. Clears min and max.",
  value: "Value",
  xAxis: "X Axis",
};
