// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMediaQuery, useTheme } from "@mui/material";
import { useCallback } from "react";

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

export function ColorSchemeThemeProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [colorScheme = "system"] = useAppConfigurationValue<string>(AppSetting.COLOR_SCHEME);
  const systemSetting = useMediaQuery("(prefers-color-scheme: dark)", { noSsr: true });
  const isDark = colorScheme === "dark" || (colorScheme === "system" && systemSetting);
  return <ThemeProvider isDark={isDark}>{children}</ThemeProvider>;
}

/** Switches the app to the opposite of the theme it shows now (also when following the system). */
export function useToggleColorScheme(): () => void {
  const mode = useTheme().palette.mode;
  const [, setColorScheme] = useAppConfigurationValue<string>(AppSetting.COLOR_SCHEME);
  return useCallback(() => {
    void setColorScheme(mode === "dark" ? "light" : "dark");
  }, [mode, setColorScheme]);
}
