// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SvgIcon, SvgIconProps } from "@mui/material";
import { useId } from "react";

import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";

/** Sample columns separated by a plotted signal. */
export function TraceMark(): React.JSX.Element {
  const maskId = useId();
  return (
    <>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="80" height="80">
          <rect width="80" height="80" fill="white" />
          <path
            d="M3 52H18L29 38L39 44L54 21L64 30H80"
            fill="none"
            stroke="black"
            strokeWidth="5.5"
            strokeLinejoin="round"
          />
          <path d="M23 4V77M39 4V77M55 4V77" stroke="black" strokeWidth="3.2" />
        </mask>
      </defs>
      <path fill="#F57E29" d="M9 7H42A33 33 0 0 1 42 73H9Z" mask={`url(#${maskId})`} />
    </>
  );
}

export function LichtblickLogo(props: SvgIconProps): React.JSX.Element {
  return (
    <SvgIcon viewBox="0 0 80 80" {...props}>
      <title>{APP_CONFIG.productName}</title>
      <TraceMark />
    </SvgIcon>
  );
}
