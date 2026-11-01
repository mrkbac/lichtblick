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
    main: "#1C2526",
    primary: "#4B6568",
    text: "#ffffff",
  },
  primary: { main: "#F57E29" },
  secondary: { main: "#A0B8BA" },
  error: { main: "#f54966" },
  warning: { main: "#eba800" },
  success: { main: "#92c353" },
  info: { main: "#29bee7" },
  text: {
    primary: "#E4ECEC",
    secondary: "#A0B8BA",
  },
  divider: "#3A4E50",
  background: {
    default: "#101616",
    paper: "#182021",
    menu: "#1F2A2B",
  },
  grey: {
    50: "#0D1112",
    100: "#101616",
    200: "#131A1B",
    300: "#182021",
    400: "#1B2425",
    500: "#1D2728",
    600: "#1F2A2B",
    700: "#222E2F",
    800: "#273435",
    900: "#2D3C3E",
    A100: "#202B2C",
    A200: "#4B6568",
    A400: "#A0B8BA",
    A700: "#CAD7D8",
  },
};

export const light: PaletteOptions = {
  name: "light",
  mode: "light",
  tonalOffset: 0.22,
  appBar: {
    main: "#2D3131",
    primary: "#454B4B",
    text: "#ffffff",
  },
  primary: { main: "#F57E29" },
  secondary: { main: "#454B4B" },
  error: { main: "#db3553" },
  warning: { main: "#eba800" },
  success: { main: "#107c10" },
  info: { main: "#1EA7FD" },
  background: {
    default: "#F5F6F6",
    paper: "#ffffff",
    menu: "#ffffff",
  },
  text: {
    primary: "#2D3131",
    secondary: "#757E7F",
  },
  divider: "#D3D8D8",
  grey: {
    50: "#FAFBFB",
    100: "#F5F6F6",
    200: "#E4E7E7",
    300: "#D3D8D8",
    400: "#B1BABB",
    500: "#96A2A3",
    600: "#757E7F",
    700: "#5D6465",
    800: "#454B4B",
    900: "#2D3131",
    A100: "#D3D8D8",
    A200: "#B1BABB",
    A400: "#5D6465",
    A700: "#373B3B",
  },
};
