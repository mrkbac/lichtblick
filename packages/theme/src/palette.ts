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

/** Orange accents and the corporate stone neutral scale. */
export const BRAND = {
  orange: { 500: "#F57E29", 600: "#D16B23", 950: "#4A260C" },
  stone: {
    50: "#F5F6F6",
    100: "#E4E7E7",
    200: "#D3D8D8",
    300: "#C2C9CA",
    400: "#B1BABB",
    500: "#96A2A3",
    600: "#8D9899",
    700: "#757E7F",
    800: "#5D6465",
    900: "#454B4B",
    950: "#2D3131",
    dark50: "#3E4444",
    dark100: "#353A3A",
    dark200: "#2E3232",
    dark300: "#2C3030",
    dark400: "#282B2B",
    dark500: "#232626",
    dark600: "#212424",
    dark700: "#1E2020",
    dark800: "#1A1C1C",
    dark900: "#171A1A",
    dark950: "#141515",
    dark1000: "#101212",
  },
} as const;

const { orange, stone } = BRAND;

/** Brand accent (buttons, links, focus). */
export const ACCENT = orange[500];

export const dark: PaletteOptions = {
  name: "dark",
  mode: "dark",
  tonalOffset: 0.15,
  appBar: {
    main: stone.dark950,
    primary: stone[600],
    text: stone[50],
  },
  primary: { main: ACCENT },
  secondary: { main: stone[400] },
  error: { main: "#f2556f" },
  warning: { main: "#f0b429" },
  success: { main: "#4ade80" },
  info: { main: "#38bdf8" },
  text: {
    primary: stone[100],
    secondary: stone[500],
  },
  divider: stone.dark400,
  background: {
    default: stone.dark950,
    paper: stone.dark800,
    menu: stone.dark600,
  },
  grey: {
    50: stone.dark1000,
    100: stone.dark950,
    200: stone.dark900,
    300: stone.dark700,
    400: stone.dark500,
    500: stone.dark400,
    600: stone.dark200,
    700: stone.dark100,
    800: stone.dark50,
    900: stone[900],
    A100: stone.dark300,
    A200: stone[800],
    A400: stone[400],
    A700: stone[200],
  },
};

export const light: PaletteOptions = {
  name: "light",
  mode: "light",
  tonalOffset: 0.22,
  appBar: {
    main: stone.dark800,
    primary: stone[600],
    text: "#ffffff",
  },
  // The darker brand orange keeps links and outlined controls readable on white.
  primary: { main: orange[600] },
  secondary: { main: stone[900] },
  error: { main: "#db3553" },
  warning: { main: "#d97706" },
  success: { main: "#107c10" },
  info: { main: "#0284c7" },
  background: {
    default: stone[50],
    paper: "#ffffff",
    menu: "#ffffff",
  },
  text: {
    primary: stone.dark600,
    secondary: stone[800],
  },
  divider: stone[100],
  grey: {
    50: stone[50],
    100: stone[100],
    200: stone[200],
    300: stone[300],
    400: stone[400],
    500: stone[500],
    600: stone[700],
    700: stone[800],
    800: stone[900],
    900: stone[950],
    A100: stone[200],
    A200: stone[400],
    A400: stone[800],
    A700: stone[950],
  },
};
