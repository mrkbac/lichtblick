// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PaletteOptions } from "@mui/material/styles";
import { CSSProperties } from "react";

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

export const dark: PaletteOptions = {
  name: "dark",
  mode: "dark",
  tonalOffset: 0.15,
  appBar: {
    main: "#241E29",
    primary: "#8A7E8F",
    text: "#ffffff",
  },
  primary: { main: "#E07BB8" },
  secondary: { main: "#B5AABA" },
  error: { main: "#f54966" },
  warning: { main: "#eba800" },
  success: { main: "#7FB07F" },
  info: { main: "#29bee7" },
  text: {
    primary: "#EEE8F0",
    secondary: "#A99DAE",
  },
  divider: "#4A4150",
  background: {
    default: "#16121A",
    paper: "#1E1923",
    menu: "#2A2330",
  },
  grey: {
    50: "#121217",
    100: "#16161b",
    200: "#212127",
    300: "#27272b",
    400: "#2d2d33",
    500: "#2f2f35",
    600: "#33333a",
    700: "#35353d",
    800: "#3b3b44",
    900: "#45474d",
    A100: "#313138",
    A200: "#60636c",
    A400: "#aeb0b7",
    A700: "#d2d5df",
  },
};

export const light: PaletteOptions = {
  name: "light",
  mode: "light",
  tonalOffset: 0.22,
  appBar: {
    main: "#241C27",
    primary: "#4A3F4E",
    text: "#ffffff",
  },
  primary: { main: "#A8327A" },
  secondary: { main: "#4A3F4E" },
  error: { main: "#db3553" },
  warning: { main: "#eba800" },
  success: { main: "#4F7D52" },
  info: { main: "#1EA7FD" },
  background: {
    default: "#F6F3F7",
    paper: "#ffffff",
    menu: "#ffffff",
  },
  text: {
    primary: "#241C27",
    secondary: "#6E6372",
  },
  divider: "#E2DAE5",
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
