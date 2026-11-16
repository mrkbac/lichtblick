// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

import { PANEL_ROOT_CLASS_NAME } from "@lichtblick/suite-base/components/PanelRoot";
import {
  COMPACT_PANELS_ATTRIBUTE,
  PANEL_TOOLBAR_HEIGHT,
} from "@lichtblick/suite-base/components/PanelToolbar/constants";

const COMPACT = `[${COMPACT_PANELS_ATTRIBUTE}]`;
const PANEL = `.${PANEL_ROOT_CLASS_NAME}`;
/** The hovered panel itself, not a Tab panel around it. */
const HOVERED_PANEL = `${PANEL}:hover:not(:has(${PANEL}:hover))`;

export const useStyles = makeStyles()((theme) => ({
  root: {
    transition: "transform 80ms ease-in-out, opacity 80ms ease-in-out",
    cursor: "auto",
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: theme.spacing(0.25, 0.75),
    display: "flex",
    minHeight: PANEL_TOOLBAR_HEIGHT,
    backgroundColor: theme.palette.background.paper,
    width: "100%",
    left: 0,
    zIndex: theme.zIndex.appBar,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    position: "relative !important" as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    top: "auto !important" as any,

    [`${COMPACT} &`]: {
      paddingBlock: 0,
      // Topic and path inputs in toolbars would otherwise keep the toolbar at full height.
      // `!important` beats the Autocomplete's own size rules, whatever their specificity.
      ".MuiInputBase-root": { paddingBlock: `${theme.spacing(0.25)} !important` },
    },
  },
  // In compact mode a toolbar with only a title floats over the panel and shows while it's hovered.
  floating: {
    [`${COMPACT} &`]: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      position: "absolute !important" as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      top: "0 !important" as any,
      opacity: 0,
      transition: "opacity 80ms ease-in-out",
    },
    // Only the hovered panel's own toolbar: pointing at a Tab panel's strip shows none of the
    // toolbars of the panels in its tabs.
    [`${COMPACT} ${HOVERED_PANEL} &:not(${HOVERED_PANEL} ${PANEL} *), ${COMPACT} &:focus-within`]: {
      opacity: 1,
    },
  },
  content: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    // Like the toolbar: content sits next to the controls, but when it overflows its start stays.
    justifyContent: "safe flex-end",
  },
  grip: {
    display: "flex",
    alignItems: "center",
    flex: "none",
    alignSelf: "stretch",
    marginLeft: theme.spacing(-0.5),
    fontSize: theme.typography.body1.fontSize,
    color: theme.palette.text.disabled,
    cursor: "grab",

    "&:hover": { color: theme.palette.text.secondary },
  },
}));
