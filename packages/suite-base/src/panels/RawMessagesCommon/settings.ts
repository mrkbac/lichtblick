// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { FONT_SIZE_OPTIONS } from "@lichtblick/suite-base/panels/RawMessagesCommon/constants";
import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";

/** Settings tree of the Raw Messages panels; `fontSize` undefined is "auto". */
export function buildSettingsTree(fontSize: number | undefined): DocumentedNodes {
  return {
    general: {
      label: "General",
      fields: {
        fontSize: {
          label: "Font size",
          help: "Text size of the message tree; auto uses the default size.",
          input: "select",
          options: [
            { label: "auto", value: undefined },
            ...FONT_SIZE_OPTIONS.map((value) => ({
              label: `${value} px`,
              value,
            })),
          ],
          value: fontSize,
        },
      },
    },
  };
}
