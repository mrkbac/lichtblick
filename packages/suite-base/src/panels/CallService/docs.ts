// SPDX-License-Identifier: MPL-2.0

import { MESSAGE_EDITOR_BUTTONS } from "@lichtblick/suite-base/components/MessageEditor/buttons";
import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { CALL_SERVICE_BUTTONS } from "./buttons";
import { buildSettingsTree, defaultConfig } from "./settings";

const docs: PanelDocs = {
  intro: "Calls a service with a request you edit and shows the response.",
  buttons: [...Object.values(MESSAGE_EDITOR_BUTTONS), ...Object.values(CALL_SERVICE_BUTTONS)],
  settings: () => buildSettingsTree(defaultConfig, []),
  sections: [
    {
      title: "Request",
      items: [["Form / JSON", "Edit fields in a form or as raw JSON."]],
    },
    {
      title: "Response",
      items: [["History", "Pick an earlier call to see its response and latency."]],
    },
  ],
};

export default docs;
