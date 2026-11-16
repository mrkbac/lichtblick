// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Title (tooltip) and help (panel guide) of every built-in panel button, keyed by
 * `PanelButton.id`. Both are required, so a button can't ship undocumented.
 */
export const panelButtons = {
  mapZoomToData: { title: "Zoom to data", help: "Fits the map to all shown topics." },
  mapMeasuringTools: {
    title: "Measuring tools",
    help: "Shown instead of the tools when the panel is short: opens them, showing the active tool.",
  },
  mapMeasureDistance: {
    title: "Measure distance and area",
    help: "Measures a path; close it on its first point to measure an area. Shows the length over terrain with 3D terrain.",
  },
  mapMeasureHeight: {
    title: "Measure height difference",
    help: "Height, horizontal and slope distance, and grade between two points. Needs 3D terrain.",
  },
  mapMeasureAngle: {
    title: "Measure angle",
    help: "The angle at the middle of three points, in 3D with terrain, plus the other corners.",
  },
  mapPinPoints: {
    title: "Pin points",
    help: "Labels points with their coordinates, plus elevation and slope with 3D terrain.",
  },
  mapClearMeasurements: {
    title: "Clear all measurements",
    help: "Removes every measurement from the map.",
  },
  plotResetView: {
    title: "Reset view",
    help: "Shown after zooming or panning: returns to the default view.",
  },
  plotLegend: { title: "Legend", help: "Shows or hides the legend." },
  plotBoxZoom: {
    title: "Zoom tool",
    help: "Zooms to a box drawn over the plot, on both axes or on one.",
  },
  plotMeasure: {
    title: "Measure delta",
    help: "Places P1/P2 markers and shows the deltas and range statistics between them.",
  },
  plotToggleSeries: { title: "Toggle visibility", help: "Hides or shows a series." },
  plotAddSeries: {
    title: "Add series",
    help: "Shown while the plot has no series: opens the settings of a first series.",
  },
  plotDeleteSeries: { title: "Delete series", help: "Removes the series from the plot." },
  publishRepeat: {
    title: "Publish repeatedly",
    help: "Publishes continuously at the repeat rate until stopped.",
  },
  rawMessagesDiff: {
    title: "Toggle diff",
    help: "Compares against the previous message or another path, with changes highlighted.",
  },
  rawMessagesExpandAll: { title: "Expand all", help: "Opens every node of the tree." },
  rawMessagesCollapseAll: {
    title: "Collapse all",
    help: "Shown while every node is open: closes them all.",
  },
  rawMessagesSearch: {
    title: "Search fields and values",
    help: "Highlights matching fields and values in the message.",
  },
  rawMessagesPreviousMessage: {
    title: "Previous message",
    help: "Jumps to the previous message on the topic.",
  },
  rawMessagesNextMessage: {
    title: "Next message",
    help: "Jumps to the next message on the topic.",
  },
  rawMessagesCopyMessage: { title: "Copy message", help: "Copies the whole message as JSON." },
  rawMessagesDragValue: {
    title: "Drag to a panel",
    help: "Grip shown next to a hovered field: carries its path to another panel.",
  },
  rawMessagesCopyValue: { title: "Copy to clipboard", help: "Copies the value as JSON." },
  rawMessagesFilter: {
    title: "Filter on this value",
    help: "Rewrites the path to keep only array items with this value.",
  },
  rawMessagesPlotLine: {
    title: "Plot this value on a line chart",
    help: "Adds the value to the Plot panel next to this one.",
  },
  rawMessagesPlotScatter: {
    title: "Plot this value on a scatter plot",
    help: "Adds the value across all array items to the Plot panel next to this one.",
  },
  rawMessagesStateTransitions: {
    title: "View state transitions for this value",
    help: "Opens the value in a State Transitions panel next to this one.",
  },
  logCopy: { title: "Copy logs", help: "Copies all messages that pass the filters." },
  logMatchCase: { title: "Match case", help: "Makes search terms case-sensitive." },
  logRegex: {
    title: "Use regular expression",
    help: "Treats search terms as regular expressions.",
  },
  logPreviousProblem: {
    title: "Previous warning or error",
    help: "Scrolls to the previous warning or error.",
  },
  logNextProblem: {
    title: "Next warning or error",
    help: "Scrolls to the next warning or error.",
  },
  logCopyMessage: {
    title: "Copy log message",
    help: "Shown on hover: copies that one message.",
  },
  logFollowPlayhead: {
    title: "Follow playhead",
    help: "Shown after you scroll away: keeps the latest message in view again.",
  },
  parametersRegex: {
    title: "Use regular expression",
    help: "Treats the filter as a regular expression.",
  },
  parametersFlatList: {
    title: "Show flat list",
    help: "Lists parameters by full name instead of a namespace tree.",
  },
  parametersGroupByNamespace: {
    title: "Group by namespace",
    help: "Shows parameters as a tree of namespaces.",
  },
  parametersExpandAll: { title: "Expand all", help: "Opens every namespace in the tree." },
  parametersCollapseAll: { title: "Collapse all", help: "Closes every namespace in the tree." },
  parametersSnapshots: {
    title: "Snapshots",
    help: "Saves, imports or exports parameters as YAML, and picks a snapshot to compare with.",
  },
  parametersExportSnapshot: {
    title: "Export as YAML",
    help: "In the snapshots menu: downloads that snapshot as a YAML file.",
  },
  parametersDeleteSnapshot: {
    title: "Delete snapshot",
    help: "In the snapshots menu: removes that snapshot from the layout.",
  },
  parametersStopComparing: { title: "Stop comparing", help: "Closes the snapshot comparison." },
  parametersSubmitValue: {
    title: "Submit",
    help: "Shown while editing a value: sets the parameter to it.",
  },
  parametersResetValue: {
    title: "Reset",
    help: "Shown while editing a value: discards the edit.",
  },
  parametersRestoreValue: {
    title: "Restore snapshot value",
    help: "Shown on a changed or removed parameter while comparing: sets it back to the snapshot value.",
  },
  topicHealthDetailedStats: {
    title: "Detailed statistics",
    help: "In each row: scans the recording, or subscribes on live sources, for the topic's jitter, max gap and bandwidth. Again hides them.",
  },
  topicHealthOpenInRawMessages: {
    title: "Open in Raw Messages",
    help: "In each row: opens the topic in a Raw Messages panel next to this one.",
  },
  transformTreeMeasureFrom: {
    title: "Measure from here",
    help: "Shown on hover of a frame: starts a frame-to-frame measurement there, shared with the layout's 3D panels.",
  },
  transformTreeMeasureTo: {
    title: "Measure to here",
    help: "Shown on hover of a frame: ends the frame-to-frame measurement there.",
  },
  transformTreeCloseEditor: {
    title: "Close",
    help: "Closes the offset editor; the offset stays applied.",
  },
  userScriptsScripts: { title: "Scripts", help: "Lists your scripts; select one to edit it." },
  userScriptsUtilities: {
    title: "Utilities",
    help: "Read-only helper modules your scripts can import.",
  },
  userScriptsTemplates: {
    title: "Templates",
    help: "Example scripts; selecting one creates a new script from it.",
  },
  userScriptsCollapseSidebar: { title: "Collapse", help: "Hides the sidebar's list." },
  userScriptsRename: { title: "Rename", help: "Next to each script: renames it." },
  userScriptsDelete: { title: "Delete", help: "Next to each script: deletes it." },
  userScriptsGoBack: {
    title: "Go back",
    help: "Shown after opening a utility or a definition: returns to the previous file.",
  },
  watchAdd: { title: "Add", help: "Adds the typed message path as a row." },
  watchCopyValue: { title: "Copy value", help: "Shown on hover: copies the row's current value." },
  watchEditPath: { title: "Edit path", help: "Shown on hover: edits the row's message path." },
  watchDuplicate: {
    title: "Duplicate",
    help: "Shown on hover: adds a copy of the row below it and edits its path.",
  },
  watchRemove: { title: "Remove", help: "Shown on hover: removes the row." },
  watchAddAsRow: {
    title: "Add as row",
    help: "Shown on hover of a field in an expanded row: adds that field as its own row.",
  },
  diagnosticStatusCopyStatus: {
    title: "Copy status as JSON",
    help: "In each check's header: copies the whole status message as JSON.",
  },
  diagnosticStatusCopyValue: {
    title: "Copy value",
    help: "Next to each value: copies that one value.",
  },
  diagnosticStatusOpenInPlot: {
    title: "Open in Plot panel",
    help: "Next to a numeric value: adds it to the Plot panel next to this one, opening one if needed.",
  },
  diagnosticStatusOpenInStateTransitions: {
    title: "Open in State Transitions panel",
    help: "Next to a text value or the status message: adds it to the State Transitions panel next to this one, opening one if needed.",
  },
  diagnosticSummaryPin: {
    title: "Pin check",
    help: "Next to each check: keeps it at the top of the list.",
  },
  indicatorMuteAlerts: {
    title: "Mute alerts",
    help: "Shown while a rule has an alert: silences this panel's sounds and notifications until turned off.",
  },
  stateTransitionsPreviousMatch: {
    title: "Previous match",
    help: "Shown when a series has a condition: seeks to the previous time it became true.",
  },
  stateTransitionsNextMatch: {
    title: "Next match",
    help: "Shown when a series has a condition: seeks to the next time it became true.",
  },
  stateTransitionsMeasure: {
    title: "Measure delta",
    help: "Toggles measure mode, which places P1 and P2 markers and shows the time between them.",
  },
  tableExpandRow: {
    title: "Expand row",
    help: "In rows with nested messages or arrays: opens or closes a sub-table.",
  },
  tableCollapseCell: {
    title: "Collapse",
    help: "Shown on an opened object cell: closes it again.",
  },
  tableFirstPage: { title: "First page", help: "Jumps to the first page." },
  tablePreviousPage: { title: "Previous page", help: "Shows the previous page." },
  tableNextPage: { title: "Next page", help: "Shows the next page." },
  tableLastPage: { title: "Last page", help: "Jumps to the last page." },
  teleopStop: {
    title: "Stop",
    help: "Publishes a zero command and ignores input until every control is released.",
  },
  topicGraphTopics: {
    title: "Topics",
    help: "Opens the topic filter: all, none, published, subscribed or (dis)connected topics. Its tooltip names the current choice.",
  },
  topicGraphZoomFit: { title: "Zoom fit", help: "Fits the whole graph into the panel." },
  topicGraphOrientation: {
    title: "Orientation",
    help: "Switches between top-down and left-to-right layout.",
  },
  topicGraphServices: { title: "Show services", help: "Shows or hides service nodes." },
  tabClose: {
    title: "Close tab",
    help: "Shown on a hovered tab: removes it and its panels. With one tab left, the tab panel is replaced by its contents.",
  },
  stateTransitionsDeleteSeries: {
    title: "Delete series",
    help: "Next to each series in the legend: removes it from the panel.",
  },
  threeDeeInspect: {
    title: "Inspect objects",
    help: "Turns on object inspection: shows the selected object's message and summarizes objects under the cursor.",
  },
  threeDeePerspective: {
    title: "3D camera",
    help: "Switches between a perspective 3D camera and a top-down 2D camera.",
  },
  threeDeeZoomToData: {
    title: "Zoom to data",
    help: "Fits the camera to the shown topics, ignoring map tiles, grids, and frame axes.",
  },
  threeDeeMeasure: {
    title: "Measure",
    help: "Measures points, distances, polylines, angles, areas, heights, and height profiles in the scene.",
  },
  threeDeeMeasureFrames: {
    title: "Measure between frames",
    help: "Shows the distance and rotation between two frames you pick in the scene.",
  },
  threeDeePublish: {
    title: "Publish",
    help: "Publishes a point, pose, or pose estimate where you pick in the scene. Shown for ROS connections that can publish.",
  },
  imageDownload: {
    title: "Download image",
    help: "Saves the current image as a PNG, rotated and flipped like the view, without annotations.",
  },
  imageResetView: {
    title: "Reset view",
    help: "Shown after zooming or panning: fits the whole image again.",
  },
  audioMute: { title: "Mute", help: "Mutes or unmutes playback without changing the volume." },
  callServiceRestoreRequest: {
    title: "Restore request",
    help: "Copies the selected call's service and request back into the editor.",
  },
  callServiceRerun: { title: "Re-run call", help: "Calls again with the selected call's request." },
  deltaOverlayRemoveMarkerA: {
    title: "Remove marker A",
    help: "In the measure overlay: removes the first marker.",
  },
  deltaOverlayRemoveMarkerB: {
    title: "Remove marker B",
    help: "In the measure overlay: removes the second marker.",
  },
  sourceInfoCopyTopicName: {
    title: "Copy topic name",
    help: "Next to each topic: copies its name.",
  },
  messageEditorPresets: {
    title: "Presets",
    help: "Loads a saved message, saves the current one under a name, or deletes a saved one.",
  },
  messageEditorResetToTemplate: {
    title: "Reset to an empty template",
    help: "Replaces the message with an empty template built from its definition.",
  },
  sourceInfoSortDirection: {
    title: "Reverse sort direction",
    help: "Flips the order of the chosen sort column; the arrow shows the current direction.",
  },
} satisfies Record<string, { title: string; help: string }>;
