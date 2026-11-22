// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SvgIcon, SvgIconProps } from "@mui/material";

import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { fontSansSerif } from "@lichtblick/theme";

import { TraceMark } from "./LichtblickLogo";

export default function LichtblickLogoText(props: SvgIconProps): React.JSX.Element {
  return (
    <SvgIcon viewBox="0 0 136 34" {...props}>
      <g transform="translate(1 0) scale(0.425)">
        <TraceMark />
      </g>
      <text
        x="42"
        y="25"
        fontFamily={fontSansSerif}
        fontSize="24"
        fontWeight="700"
        letterSpacing="-0.8"
      >
        {APP_CONFIG.productName}
      </text>
    </SvgIcon>
  );
}
