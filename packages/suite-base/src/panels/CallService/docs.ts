// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Calls a service with a request you edit and shows the response.",
  sections: [
    {
      title: "Settings",
      items: [
        ["Service name", "Service to call; picking one fills in an empty request template."],
        ["Layout", "Place the request and response side by side or stacked."],
        ["Button", "Title, tooltip and color of the call button."],
      ],
    },
    {
      title: "Request",
      items: [
        ["Form / JSON", "Edit fields in a form or as raw JSON."],
        ["Presets", "Save the current request under a name and load it later."],
      ],
    },
    {
      title: "Response",
      items: [
        ["History", "Pick an earlier call to see its response and latency."],
        ["Restore request", "Copies that call's request back into the editor."],
        ["Re-run", "Calls again with that call's request."],
      ],
    },
  ],
};

export default docs;
