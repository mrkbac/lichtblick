// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha, iconButtonClasses, Paper, PaperProps } from "@mui/material";
import { makeStyles } from "tss-react/mui";

export const OVERLAY_TOOLBAR_BUTTON_SIZE = 32;

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    pointerEvents: "auto",
    [`& .${iconButtonClasses.root}`]: {
      width: OVERLAY_TOOLBAR_BUTTON_SIZE,
      height: OVERLAY_TOOLBAR_BUTTON_SIZE,
      padding: theme.spacing(0.75),
      [`&[aria-pressed=true]:not(.${iconButtonClasses.disabled})`]: {
        color: theme.palette.primary.main,
        backgroundColor: alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity),
        "&:hover": {
          backgroundColor: alpha(
            theme.palette.primary.main,
            theme.palette.action.selectedOpacity + theme.palette.action.hoverOpacity,
          ),
        },
      },
    },
  },
}));

/** Floating panel controls share a surface and fixed-size buttons, including text icons. */
export default function OverlayToolbar(props: PaperProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  return (
    <Paper {...props} square={false} elevation={4} className={cx(classes.root, props.className)} />
  );
}
