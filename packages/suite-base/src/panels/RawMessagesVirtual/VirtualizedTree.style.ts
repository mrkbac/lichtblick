// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

import { diffLabels } from "@lichtblick/suite-base/panels/RawMessagesCommon/types";
import { JSON_TREE_THEME_COLORS } from "@lichtblick/suite-base/util/constants";
import { customTypography } from "@lichtblick/theme";

export const useStyles = makeStyles()((theme) => {
  // Use the same color scheme as useJsonTreeTheme for consistency with RawMessages
  const colors = JSON_TREE_THEME_COLORS[theme.palette.mode];
  const isDark = theme.palette.mode === "dark";

  return {
    wrapper: {
      position: "relative",
      flex: "auto",
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
    },
    container: {
      overflow: "auto",
      contain: "strict",
      height: "100%",
      width: "100%",
      outline: "none",
    },
    breadcrumb: {
      // Always present (even when empty) so the list never shifts while scrolling.
      flex: "none",
      minHeight: "1.6em",
      display: "flex",
      flexWrap: "nowrap",
      gap: theme.spacing(0.5),
      overflow: "hidden",
      whiteSpace: "nowrap",
      padding: theme.spacing(0.25, 0.5),
      backgroundColor: theme.palette.background.paper,
      borderBottom: `1px solid ${theme.palette.divider}`,
      color: colors.label,
      fontFamily: theme.typography.body1.fontFamily,
    },
    breadcrumbSeparator: {
      color: theme.palette.text.disabled,
    },
    activeRow: {
      "[role=tree]:focus-visible &": {
        outline: `1px solid ${theme.palette.primary.main}`,
        outlineOffset: -1,
      },
    },
    added: {
      backgroundColor: isDark
        ? diffLabels.ADDED.invertedBackgroundColor
        : diffLabels.ADDED.backgroundColor,
    },
    deleted: {
      backgroundColor: isDark
        ? diffLabels.DELETED.invertedBackgroundColor
        : diffLabels.DELETED.backgroundColor,
      textDecoration: "line-through",
    },
    changedValue: {
      "& > :last-child": {
        backgroundColor: theme.palette.action.selected,
        borderRadius: theme.shape.borderRadius,
      },
    },
    searchMatch: {
      "& > span:nth-of-type(2)": {
        backgroundColor: theme.palette.warning.main,
        color: theme.palette.warning.contrastText,
        borderRadius: theme.shape.borderRadius,
      },
    },
    innerWrapper: {
      width: "100%",
      position: "relative",
    },
    row: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "flex-start",
      padding: "2px 0",
      fontFamily: theme.typography.body1.fontFamily,
      fontFeatureSettings: `${customTypography.fontFeatureSettings}, "zero"`,
      fontSize: "inherit",
      lineHeight: 1.4,
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
    },
    expandButton: {
      cursor: "pointer",
      userSelect: "none",
      minWidth: 12,
      marginRight: theme.spacing(0.5),
      color: colors.label,
      fontSize: theme.typography.pxToRem(11),
      alignSelf: "center",
    },
    spanButton: {
      cursor: "pointer",
      userSelect: "none",
      background: "none",
      border: "none",
      padding: 0,
      font: "inherit",
      textAlign: "left",
      color: "inherit",
    },
    key: {
      color: colors.label,
      marginRight: theme.spacing(0.5),
    },
    valueContainer: {
      flex: "1 1 auto",
      minWidth: 0,
      overflow: "visible",
      wordBreak: "break-all",
      overflowWrap: "anywhere",
    },
    value: {
      color: colors.text,
      wordBreak: "break-word",
      overflowWrap: "anywhere",
    },
    string: {
      color: colors.string,
    },
    number: {
      color: colors.number,
    },
    boolean: {
      color: colors.number,
    },
    null: {
      color: colors.null,
    },
    objectLabel: {
      color: theme.palette.text.secondary,
      fontStyle: "italic",
    },
  };
});
