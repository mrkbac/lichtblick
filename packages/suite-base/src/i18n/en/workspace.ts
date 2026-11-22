// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const workspace = {
  events: "Events",
  layoutHistory: "History",
  panel: "Panel",
  performance: "Performance",
  alerts: "Alerts",
  attachments: "Attachments",
  studioLogs: "Logs",
  topics: "Topics",
  variables: "Variables",
  trustImportedScriptsTitle: "Run user scripts from this imported layout?",
  trustSharedScriptsTitle: "Run user scripts from this shared layout?",
  trustScriptsDescription_one:
    "This layout contains a user script: {{names}}. User scripts run code in your browser and can change the data you see.",
  trustScriptsDescription_other:
    "This layout contains user scripts: {{names}}. User scripts run code in your browser and can change the data you see.",
  trustImportedScriptsDescription: "Only run them if you trust whoever provided this layout.",
  trustSharedScriptsDescription:
    "Anyone who can edit this layout in your organization can change them. Only run them if you trust those people.",
  declineUserScripts: "Don’t run",
  allowUserScripts: "Run scripts",
};
