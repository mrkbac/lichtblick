// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const dataSourceInfo = {
  copyValue: "Copy {{label}}",
  currentSource: "Current source",
  dataSource: "Data source",
  duration: "Duration",
  endTime: "End time",
  files: "Files",
  compareFiles: "Compare side by side",
  compareFilesHint:
    "Reopen with each file under its own topic prefix (/a, /b, …), all starting at the same time",
  mergeFiles: "Merge into one recording",
  mergeFilesHint: "Reopen the files as one recording with shared topics",
  compareTab: "Compare ({{count}})",
  compareSearch: "Search topics…",
  compareOnlyDifferences: "Only differences ({{count}})",
  compareTopic: "Topic",
  compareDiffersIn: "Differs in",
  compareMissing: "missing",
  compareDifference: {
    missing: "missing",
    schema: "schema",
    rate: "rate",
  },
  compareNoTopics: "Topic comparison needs indexed MCAP files.",
  compareNoMatch: "No topics match.",
  history: "History",
  historyValue: "{{messages}} messages · {{size}} of {{limit}}",
  saveHistory: "Download history as MCAP",
  saveHistoryFailed: "Download failed: {{error}}",
  saveHistoryTitle: "Download everything in the history right now as an MCAP file",
  savedHistory: "Downloaded",
  savingHistory: "Saving…",
  session: "Session",
  sessionValue: "{{duration}} connected · {{size}} received · {{rate}}/s",
  messages: "Messages",
  schemas: "Schemas",
  startTime: "Start time",
  topics: "Topics",
  waitingForConnection: "Waiting for connection…",
};
