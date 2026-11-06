// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { makeStyles } from "tss-react/mui";

import { customTypography } from "@lichtblick/theme";

export const useStylesRawMessagesVirtual = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: "auto",
    overflow: "hidden",
    position: "relative",
    outline: "none",
  },
  topic: {
    fontFamily: theme.typography.body1.fontFamily,
    fontFeatureSettings: `${customTypography.fontFeatureSettings}, "zero"`,
  },
  hoverObserver: {
    display: "inline-flex",
    alignItems: "center",
  },
}));

export const useStylesDiffSpan = makeStyles()((theme) => ({
  root: {
    padding: theme.spacing(0, 0.5),
    textDecoration: "inherit",
    whiteSpace: "pre-line",
  },
}));

export const useStylesDiffStats = makeStyles()((theme) => ({
  diff: {
    float: "right",
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.75),
    marginRight: theme.spacing(0.75),
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: theme.spacing(0.25),
    padding: theme.spacing(0, 0.75),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
  },
  changeIndicator: {
    display: "inline-block",
    width: theme.spacing(0.75),
    height: theme.spacing(0.75),
    borderRadius: "50%",
    backgroundColor: theme.palette.warning.main,
  },
}));

export const useStylesMetadata = makeStyles()((theme) => ({
  button: {
    padding: theme.spacing(0.125),

    ".MuiSvgIcon-root": {
      fontSize: `${theme.typography.pxToRem(16)} !important`,
    },
    ".MuiButton-startIcon": {
      marginRight: theme.spacing(0.5),
    },
    "&:hover": {
      backgroundColor: "transparent",
    },
  },
}));

export const useStylesToolbar = makeStyles()((theme) => ({
  toolbar: {
    paddingBlock: 0,
    gap: theme.spacing(0.25),
  },
  iconButton: {
    padding: theme.spacing(0.25),

    "&.Mui-selected": {
      color: theme.palette.primary.main,
      backgroundColor: theme.palette.action.selected,
    },
  },
  diffOptions: {
    borderTop: `1px solid ${theme.palette.background.default}`,
    backgroundColor: theme.palette.background.paper,
    padding: theme.spacing(0.25, 0.75),
    paddingInlineEnd: theme.spacing(6.75),
    gap: theme.spacing(0.25),
    display: "flex",
  },
}));

export const useStylesValue = makeStyles()({
  // always hidden, just used to keep space and prevent resizing on hover
  placeholderActionContainer: {
    alignItems: "inherit",
    display: "inherit",
    gap: "inherit",
    visibility: "hidden",
  },
  draggable: { cursor: "grab" },
});
