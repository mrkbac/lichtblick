// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const openDialog = {
  dontShowThisAgain: "Don't show this again on startup",
  exploreSampleData: "Explore sample data",
  backToStart: "Back",
  searchCatalog: "Search recordings",
  enterOpensCatalog: "Enter opens the catalog",
  openPanelGuide: "Panel guide",
  newToLichtblick: "New to {{appName}}?",
  openConnection: "Open connection",
  openLocalFiles: "Open local file(s)...",
  compareRecordings: "Compare…",
  recentDataSources: "Recent data sources",
  openUrlPlaceholder:
    "Search recordings, or connect: robot.local, ws://host:8765, https://…/file.mcap",
  open: "Open",
  sourceType: "Source type",
  enterOpensUrl: "↵ {{url}} · {{type}}",
  enterOpens: "↵ opens {{name}}",
  unrecognizedUrl: "Unrecognized URL; pick a connection type under ⋯",
  connectionType: "Connection type…",
  detectConnectionType: "Detect from URL",
  clearRecents: "Clear unpinned",
  showAllRecents: "Show all ({{count}})",
  pin: "Pin",
  unpin: "Unpin",
  removeRecent: "Remove from recents",
  noRecents: "Files and connections you open show up here.",
  noRecentMatches: "No recent sources match this search.",
  searchHelpTitle: "Search and connect",
  searchHelpConnect:
    "Connect by typing a host (robot-1, robot.local, 192.168.1.5: a WebSocket on port 8765, when nothing in recents or the catalog matches), host:port, or a full URL (ws://, wss://, https://…/file.mcap, or an HTTP(S) catalog URL). Pick another connection type, or one without a URL, under ⋯.",
  searchHelpSearch: "Anything else searches recents and the catalog. Combine filters with text:",
  searchHelpFilters:
    "topic:/camera · schema:Image · path:2026/ · since:2026-10-01 · until:2026-10-31 · duration>5m · size<2GB · status:error|nosummary|ok · has:image|gps|pointcloud|tf|video",
  searchHelpOr: "a|b matches either. Enter opens the top result.",
  searchHelp: "Search and connect help",
  view: "View",
  tabAll: "Overview",
  tabCatalog: "Catalog",
  tabRecent: "Recent",
  tabRecordings: "Live recordings",
  sourceKind: "Source kind",
  kindAll: "All",
  kindFile: "Files",
  kindRemote: "Remote",
  kindLive: "Live",
  topicCount_one: "{{count}} topic",
  topicCount_other: "{{count}} topics",
  version: "v{{version}}",
};
