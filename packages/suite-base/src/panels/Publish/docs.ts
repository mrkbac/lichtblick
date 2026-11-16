// SPDX-License-Identifier: MPL-2.0

import { MESSAGE_EDITOR_BUTTONS } from "@lichtblick/suite-base/components/MessageEditor/buttons";
import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { PUBLISH_BUTTONS } from "./buttons";
import { buildSettingsTree, defaultConfig } from "./settingsTree";

const docs: PanelDocs = {
  intro: "Publishes a message on a topic, once or repeatedly, on data sources that support it.",
  buttons: [...Object.values(MESSAGE_EDITOR_BUTTONS), ...Object.values(PUBLISH_BUTTONS)],
  settings: () => buildSettingsTree(defaultConfig, [], []),
  sections: [
    {
      title: "Editor",
      items: [["Form / JSON", "Edit fields in a form or as raw JSON."]],
    },
  ],
};

export default docs;
