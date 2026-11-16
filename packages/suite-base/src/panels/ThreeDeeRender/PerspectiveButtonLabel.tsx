// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

import { customTypography } from "@lichtblick/theme";

const useStyles = makeStyles()((theme) => ({
  label: {
    fontFamily: customTypography.fontMonospace,
    fontFeatureSettings: theme.typography.caption.fontFeatureSettings,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    lineHeight: "1em",
  },
}));

/** The "3D" text the 2D/3D camera toggle shows in place of an icon. */
export default function PerspectiveButtonLabel(): React.JSX.Element {
  const { classes } = useStyles();
  return <span className={classes.label}>3D</span>;
}
