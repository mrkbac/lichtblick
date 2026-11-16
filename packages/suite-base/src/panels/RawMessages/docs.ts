// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { RAW_MESSAGES_BUTTONS } from "@lichtblick/suite-base/panels/RawMessagesCommon/buttons";
import { buildSettingsTree } from "@lichtblick/suite-base/panels/RawMessagesCommon/settings";
import { RAW_MESSAGES_VIRTUAL_DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/RawMessagesVirtual/constants";

const docs: PanelDocs = {
  intro: "Inspects the latest message on a topic or message path as an expandable tree.",
  buttons: Object.values(RAW_MESSAGES_BUTTONS),
  settings: () => buildSettingsTree(RAW_MESSAGES_VIRTUAL_DEFAULT_CONFIG.fontSize),
  sections: [
    {
      title: "Data",
      items: [
        ["Message path", "Any topic or path, e.g. /odom.pose.pose or /points.fields[0]."],
        ["Filters", "Narrow arrays with filters such as /diagnostics.status[:]{level==2}."],
      ],
    },
  ],
};

export default docs;
