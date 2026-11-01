// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SvgIcon, SvgIconProps } from "@mui/material";

import DigitalisIcon from "@lichtblick/suite-base/assets/digitalis-icon.svg";

export default function LichtblickLogoText(props: SvgIconProps): React.JSX.Element {
  return (
    <SvgIcon viewBox="0 0 909 204" {...props}>
      <title>Digitalis</title>
      <DigitalisIcon x={0} y={0} width={204} height={204} />
      <text x="236" y="160" fill="#F57E29" fontSize="150" fontWeight="700" fontFamily="sans-serif">
        Digitalis
      </text>
    </SvgIcon>
  );
}
