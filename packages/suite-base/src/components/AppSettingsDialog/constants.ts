// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AppSettingsSectionKey } from "@lichtblick/suite-base/components/AppSettingsDialog/types";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";

export const APP_SETTINGS_ABOUT_ITEMS = new Map<
  AppSettingsSectionKey,
  {
    subheader: string;
    links: { title: string; url?: string }[];
  }
>([
  [
    "documentation",
    {
      subheader: "Documentation",
      links: [
        {
          title: "Check out our documentation",
          url: APP_CONFIG.docsUrl,
        },
      ],
    },
  ],
  [
    "legal",
    {
      subheader: "Legal",
      links: [
        {
          title: "Source code",
          url: APP_CONFIG.repositoryUrl,
        },
        {
          title: "License terms",
          url: `${APP_CONFIG.repositoryUrl}/blob/HEAD/LICENSE`,
        },
      ],
    },
  ],
]);
