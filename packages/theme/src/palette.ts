// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { PaletteOptions } from "@mui/material/styles";
import type { CSSProperties } from "react";

declare module "@mui/material/styles" {
  interface Palette {
    name: string;
    appBar: {
      main: CSSProperties["color"];
      primary: CSSProperties["color"];
      text: CSSProperties["color"];
    };
  }
  interface PaletteOptions {
    name: string;
    appBar: {
      main: CSSProperties["color"];
      primary: CSSProperties["color"];
      text: CSSProperties["color"];
    };
  }
  interface TypeBackground {
    menu: CSSProperties["color"];
  }
}

/** Brand accent (buttons, links, focus, logo). Change this to rebrand. */
export const ACCENT = "#EF833A";

export const dark: PaletteOptions = {
  name: "dark",
  mode: "dark",
  tonalOffset: 0.15,
  appBar: {
    main: "#121317",
    primary: "#8b8c97",
    text: "#f4f4f6",
  },
  primary: { main: ACCENT },
  secondary: { main: "#b4b5bf" },
  error: { main: "#f2556f" },
  warning: { main: "#f0b429" },
  success: { main: "#4ade80" },
  info: { main: "#38bdf8" },
  text: {
    primary: "#ececf1",
    secondary: "#9a9ba7",
  },
  divider: "#26272d",
  background: {
    default: "#121317",
    paper: "#18191e",
    menu: "#1f2026",
  },
  grey: {
    50: "#0f1013",
    100: "#121317",
    200: "#16171b",
    300: "#1c1d22",
    400: "#212228",
    500: "#26272d",
    600: "#2c2d34",
    700: "#33343c",
    800: "#3c3d46",
    900: "#474852",
    A100: "#2a2b32",
    A200: "#5e606b",
    A400: "#aeb0ba",
    A700: "#d6d8e0",
  },
};

export const light: PaletteOptions = {
  name: "light",
  mode: "light",
  tonalOffset: 0.22,
  appBar: {
    main: "#18191d",
    primary: "#6b6c76",
    text: "#ffffff",
  },
  primary: { main: ACCENT },
  secondary: { main: "#404040" },
  error: { main: "#db3553" },
  warning: { main: "#d97706" },
  success: { main: "#107c10" },
  info: { main: "#0284c7" },
  background: {
    default: "#f7f8fa",
    paper: "#ffffff",
    menu: "#ffffff",
  },
  text: {
    primary: "#1f2027",
    secondary: "#6b6c78",
  },
  divider: "#e2e4e9",
  grey: {
    50: "#fafafa",
    100: "#f5f5f5",
    200: "#eeeeee",
    300: "#e0e0e0",
    400: "#bdbdbd",
    500: "#9e9e9e",
    600: "#757575",
    700: "#616161",
    800: "#424242",
    900: "#212121",
    A100: "#d5d5d5",
    A200: "#aaaaaa",
    A400: "#616161",
    A700: "#303030",
  },
};
