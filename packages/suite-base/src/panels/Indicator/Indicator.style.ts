// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

import { IndicatorStyle } from "@lichtblick/suite-base/panels/Indicator/types";

export const useStyles = makeStyles<Partial<{ style: IndicatorStyle; backgroundColor: string }>>()(
  ({ spacing }, { style, backgroundColor = "transparent" }) => ({
    indicatorStack: {
      flexGrow: 1,
      justifyContent: "space-around",
      alignItems: "center",
      overflow: "hidden",
      padding: spacing(1),
      backgroundColor: style === "background" ? backgroundColor : "transparent",
      // Size the dot and label from the panel, not the window.
      containerType: "size",
    },
    muteButton: {
      position: "absolute",
      top: spacing(0.5),
      right: spacing(0.5),
    },
    stack: {
      flexDirection: "row",
      alignItems: "center",
      gap: "0.5em",
      fontSize: "clamp(11px, 9cqmin, 56px)",
      maxWidth: "100%",
      display: "flex",
      justifyContent: "center",
    },
    bulb: {
      flex: "none",
      width: "1em",
      height: "1em",
      borderRadius: "50%",
      backgroundColor,
      // A flat status dot with a soft halo and glow in its own color.
      boxShadow: [
        `0 0 0 0.2em color-mix(in srgb, ${backgroundColor} 22%, transparent)`,
        `0 0 0.8em color-mix(in srgb, ${backgroundColor} 55%, transparent)`,
      ].join(","),
      transition: "background-color 150ms ease, box-shadow 150ms ease",
    },
    typography: {
      fontWeight: 600,
      letterSpacing: "-0.01em",
      fontSize: "inherit",
      whiteSpace: "pre",
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      padding: spacing(0),
    },
  }),
);
