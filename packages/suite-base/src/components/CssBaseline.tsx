// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import { PropsWithChildren } from "react";
import { makeStyles } from "tss-react/mui";

import {
  JUNCTION_ACTIVE_CLASS,
  SASH_DRAG_ATTRIBUTE,
} from "@lichtblick/suite-base/components/sashIntersection";
import "@lichtblick/suite-base/styles/assets/inter.css";
import "@lichtblick/suite-base/styles/assets/plex-mono.css";
import { customTypography } from "@lichtblick/theme";

const useStyles = makeStyles()(({ palette, shape, typography }) => ({
  root: {
    // container styling
    height: "100%",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    flex: "1 1 100%",
    overflow: "hidden",
    background: palette.background.default,
    color: palette.text.primary,
    font: "inherit",
    fontSize: typography.body2.fontSize,
    fontFeatureSettings: customTypography.fontFeatureSettings,
    fontFamily: typography.body2.fontFamily,
    fontWeight: typography.body2.fontWeight,
    zIndex: 0,

    // Prevent scroll "bouncing" since the app workspace is not scrollable. Allows individual
    // scrollable elements to be scrolled without the whole page moving (even if they don't
    // preventDefault on scroll events).
    overscrollBehavior: "none",

    // https://github.com/necolas/normalize.css/blob/master/normalize.css#L12
    lineHeight: 1.15,

    /// --- child and element styling follows ---
    "code, pre, tt": {
      fontFamily: customTypography.fontMonospace,
      overflowWrap: "break-word",
    },
    mark: {
      color: palette.info.main,
      fontWeight: 700,
      backgroundColor: "transparent",
    },
    div: {
      "::-webkit-scrollbar": {
        width: 6,
        height: 6,
      },
      "::-webkit-scrollbar-corner": {
        background: "transparent",
      },
      "::-webkit-scrollbar-track": {
        background: "transparent",
      },
      "::-webkit-scrollbar-thumb": {
        background: palette.action.focus,
        borderRadius: 0,
      },
    },
    "p:not([class^='Mui')": {
      margin: "1em 0",

      "&:last-child": {
        marginBottom: 0,
      },
    },
    "b, strong": {
      fontWeight: 700,
    },
    canvas: {
      outline: "none",
    },
    th: {
      textAlign: "inherit",
    },

    // Panel layout (dockview). The tab strip only shows for groups with several panels; panels
    // draw their own toolbar.
    ".dockview-theme-lichtblick": {
      colorScheme: palette.mode,
      "--dv-group-view-background-color": palette.background.paper,
      "--dv-tabs-and-actions-container-background-color": palette.background.default,
      "--dv-tabs-and-actions-container-height": "28px",
      "--dv-tabs-and-actions-container-font-size": "12px",
      "--dv-tab-font-size": "12px",
      "--dv-tab-margin": "0",
      "--dv-tab-divider-color": palette.divider,
      "--dv-activegroup-visiblepanel-tab-background-color": palette.background.paper,
      "--dv-activegroup-hiddenpanel-tab-background-color": palette.background.default,
      "--dv-inactivegroup-visiblepanel-tab-background-color": palette.background.paper,
      "--dv-inactivegroup-hiddenpanel-tab-background-color": palette.background.default,
      "--dv-activegroup-visiblepanel-tab-color": palette.text.primary,
      "--dv-activegroup-hiddenpanel-tab-color": palette.text.secondary,
      "--dv-inactivegroup-visiblepanel-tab-color": palette.text.primary,
      "--dv-inactivegroup-hiddenpanel-tab-color": palette.text.secondary,
      "--dv-separator-border": palette.divider,
      "--dv-paneview-header-border-color": palette.divider,
      "--dv-sash-color": "transparent",
      "--dv-active-sash-color": palette.primary.main,
      "--dv-active-sash-transition-duration": "0.1s",
      "--dv-active-sash-transition-delay": "0.2s",
      "--dv-drag-over-background-color": alpha(palette.primary.main, 0.2),
      "--dv-drag-over-border-color": palette.primary.main,
      "--dv-edge-dock-indicator-color": palette.primary.main,
      "--dv-icon-hover-background-color": palette.action.hover,
      "--dv-tabs-container-scrollbar-color": palette.action.disabled,
      "--dv-scrollbar-background-color": palette.action.disabled,
      "--dv-overlay-z-index": 999,
      "--dv-border-radius": "0px",
      "--dv-tab-border-radius": "0px",
      "--dv-sash-border-radius": "0px",
      "--dv-dropdown-border-radius": `${shape.borderRadius}px`,
      "--dv-spacing-padding": "0px",
      "--dv-floating-border": `1px solid ${palette.divider}`,
      "--dv-floating-group-border": "none",
      "--dv-drag-over-border": "none",
      "--dv-transition-duration": "0.1s",

      // A sash dragged along with another at a junction shows as active, like the pressed one.
      [`.dv-sash.${JUNCTION_ACTIVE_CLASS}`]: {
        backgroundColor: "var(--dv-active-sash-color)",
      },
      // While a split is dragged, its cursor shows wherever the pointer goes.
      [`&[${SASH_DRAG_ATTRIBUTE}] *`]: {
        cursor: "inherit !important",
      },

      // Panels fill their group, like they did in the mosaic window body.
      ".dv-react-part": {
        display: "flex",
        width: "100%",
        height: "100%",
      },
    },
  },
}));

export default function CssBaseline(props: PropsWithChildren): React.JSX.Element {
  const { classes } = useStyles();

  return <div className={classes.root}>{props.children}</div>;
}
