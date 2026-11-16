// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

const docs: PanelDocs = {
  intro: "Set a numeric layout variable with a slider.",
  sections: [
    {
      title: "Settings",
      items: [
        ["Variable name", "The variable the slider sets (default globalVariable)."],
        ["Min, Max, Step", "Slider range and increment (default 0 to 10, step 1)."],
      ],
    },
    {
      title: "Tips",
      items: [
        [
          "Using it",
          "Reference the variable in message paths, e.g. /topic.items[$globalVariable].",
        ],
      ],
    },
  ],
};

export default docs;
