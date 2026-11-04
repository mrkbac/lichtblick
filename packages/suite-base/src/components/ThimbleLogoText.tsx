// SPDX-FileCopyrightText: Thimble contributors
// SPDX-License-Identifier: MPL-2.0

import { SvgIcon, SvgIconProps } from "@mui/material";

import { THIMBLE_DOME, THIMBLE_RIM } from "@lichtblick/suite-base/components/ThimbleLogo";

export default function ThimbleLogoText(props: SvgIconProps): React.JSX.Element {
  return (
    <SvgIcon viewBox="0 0 280 64" {...props}>
      <title>Thimble</title>
      <path fillRule="evenodd" d={THIMBLE_DOME} />
      <path d={THIMBLE_RIM} />
      <text
        x="64"
        y="50"
        fontFamily="inherit"
        fontSize="52"
        fontWeight="700"
        letterSpacing="-1.5"
        fill="currentColor"
      >
        thimble
      </text>
    </SvgIcon>
  );
}
