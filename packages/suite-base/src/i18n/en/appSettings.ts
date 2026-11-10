// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const appSettings = {
  about: "About",
  advanced: "Advanced",
  askEachTime: "Ask each time",
  colorScheme: "Color scheme",
  dark: "Dark",
  debugModeDescription: "Enable panels and features for debugging Lichtblick",
  desktopApp: "Desktop app",
  displayTimestampsIn: "Display timestamps in",
  experimentalFeatures: "Experimental features",
  experimentalFeaturesDescription: "These features are unstable and not recommended for daily use.",
  extensions: "Extensions",
  followSystem: "Follow system",
  general: "General",
  language: "Language",
  layoutDebugging: "Layout debugging",
  layoutDebuggingDescription: "Show extra controls for developing and debugging layout storage.",
  light: "Light",
  messageRate: "Message rate",
  stepSize: "Step size",
  liveHistory: "Live history",
  liveHistoryDescription:
    "Kept while connected to a live source, so you can pause and seek. The memory limit shortens the history when reached; it also shrinks on its own if the browser runs low on memory.",
  liveHistoryLength: "Length",
  liveHistoryMemory: "Memory limit",
  liveRecordingDisk: "Record live sessions to disk",
  liveRecordingOff: "Off",
  liveRecordingDescription:
    "Every live connection is recorded to an MCAP file in browser storage. When this much space is used, the oldest recordings are deleted. Find them under Live recordings in the app menu.",
  memoryUseIndicator: "Memory use indicator",
  memoryUseIndicatorDescription: "Show the app memory use in the sidebar.",
  syncLichtblickInstances: "Sync Lichtblick instances",
  syncLichtblickInstancesDescription:
    "Activates the button in the right lower corner of the application to sync Lichtblick instances opened.",
  noExperimentalFeatures: "Currently there are no experimental features.",
  openLinksIn: "Open links in",
  ros: "ROS",
  localResourceFolders: "Local resource folders",
  localResourceFoldersDescription:
    "Select a folder containing ROS packages or model assets. Packages are discovered from package.xml. Use package:// URLs or the folder URL below. Access lasts until this tab closes or reloads; reselect a folder to refresh it.",
  localResourceFoldersUnsupported:
    "This browser does not support folder access. Use a browser with the File System Access API to load local resources.",
  localResourceFolderSummary_one: "{{name}} — {{count}} ROS package",
  localResourceFolderSummary_other: "{{name}} — {{count}} ROS packages",
  selectResourceFolder: "Select resource folder",
  scanningResourceFolder: "Scanning folder…",
  removeResourceFolder: "Remove folder",
  rosPackageNotFound:
    'ROS package "{{pkgName}}" or the requested resource was not found. Select its resource folder in Settings and check the resource path.',
  localResourceInvalidManifest: "Invalid ROS package.xml: {{path}}",
  localResourceInvalidUrl: "Invalid local resource URL",
  localResourcePathOutsideFolder: "Local resource path must stay inside its folder",
  localResourceDuplicatePackage:
    'ROS package "{{name}}" exists in multiple selected locations; remove the duplicate package or selected folder',
  localResourceFolderUnavailable:
    "Local resource folder is unavailable; select it again in Settings",
  settings: "Settings",
  timestampFormat: "Timestamp format",
  webApp: "Web app",
};
