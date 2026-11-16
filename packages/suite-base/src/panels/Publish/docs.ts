// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Publishes a message on a topic, once or repeatedly, on data sources that support it.",
  sections: [
    {
      title: "Settings",
      items: [
        ["Topic", "Topic to publish on; picking an existing topic also sets its schema."],
        ["Message schema", "Type of the message; changing it fills in an empty template."],
        ["Editing mode", "Show the message editor; off leaves only the publish button."],
        ["Repeat rate (Hz)", "Rate used by the repeat button."],
        ["Button", "Title, tooltip and color of the publish button."],
      ],
    },
    {
      title: "Editor",
      items: [
        ["Form / JSON", "Edit fields in a form or as raw JSON."],
        ["Presets", "Save the current message under a name and load it later."],
        ["Repeat", "Publishes continuously at the repeat rate until stopped."],
      ],
    },
    {
      title: "Tips",
      items: [["Drop a topic", "Drag a topic onto the panel to publish on it."]],
    },
  ],
};

export default docs;
