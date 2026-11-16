// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";
import { ALLOWED_DATATYPES } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";

import { DIAGNOSTIC_STATUS_BUTTONS } from "./buttons";
import { DEFAULT_CONFIG } from "./constants";
import { buildStatusPanelSettingsTree } from "./utils/buildStatusPanelSettingsTree";

const docs: PanelDocs = {
  intro: "Shows the key/value details of one diagnostic check or all checks of one hardware ID.",
  schemas: ALLOWED_DATATYPES,
  buttons: Object.values(DIAGNOSTIC_STATUS_BUTTONS),
  settings: () =>
    buildStatusPanelSettingsTree(
      DEFAULT_CONFIG,
      { available: [], selected: [], subscribed: [] },
      sharedI18nObject.getFixedT(null, "diagnostics"),
    ),
  sections: [
    {
      title: "Data",
      items: [
        ["Pick a check", "Type in the toolbar to choose a hardware ID or a single check."],
        ["From the summary", "A check opened from Diagnostics – Summary shows here."],
        ["Changed values", "Values flash briefly when they change."],
      ],
    },
  ],
};

export default docs;
