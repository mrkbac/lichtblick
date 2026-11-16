// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CardHeader, CardHeaderProps } from "@mui/material";

import { PanelIconButton } from "@lichtblick/suite-base/components/PanelButton";

import { USER_SCRIPTS_BUTTONS } from "../buttons";

export const SidebarHeader = ({
  title,
  subheader,
  onClose,
}: {
  title: string;
  subheader?: CardHeaderProps["subheader"];
  onClose: () => void;
}): React.JSX.Element => (
  <CardHeader
    title={title}
    slotProps={{
      title: {
        variant: "h6",
      },
      subheader: {
        variant: "body2",
        color: "textSecondary",
      },
    }}
    subheader={subheader}
    action={<PanelIconButton button={USER_SCRIPTS_BUTTONS.collapseSidebar} onClick={onClose} />}
  />
);
