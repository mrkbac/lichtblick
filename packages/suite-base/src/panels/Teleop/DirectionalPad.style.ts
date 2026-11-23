// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { alpha } from "@mui/material";
import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles<void, "buttonIcon">()((theme, _params, classes) => ({
  svg: {
    label: "DirectionalPad-svg",
    maxHeight: "100%",
    maxWidth: "100%",
  },
  button: {
    label: "DirectionalPad-button",
    cursor: "pointer",
    fill: theme.palette.action.hover,
    stroke: theme.palette.divider,
    strokeWidth: 0.5,

    "&:hover": {
      fill: alpha(
        theme.palette.primary.main,
        theme.palette.action.selectedOpacity + theme.palette.action.hoverOpacity,
      ),
      stroke: theme.palette.primary.main,

      [`& + .${classes.buttonIcon}`]: {
        fill: theme.palette.primary.main,
      },
    },
    "&.active": {
      fill: `${theme.palette.primary.main} !important`,
      stroke: `${theme.palette.primary.dark} !important`,

      "&:hover": {
        [`& + .${classes.buttonIcon}`]: {
          fill: theme.palette.common.white,
        },
      },
    },
  },
  buttonIcon: {
    pointerEvents: "none",
    label: "DirectionalPad-buttonIcon",
    fill: theme.palette.text.primary,
  },
}));
