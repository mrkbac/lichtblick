// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSyncExternalStore } from "react";

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function subscribeDarkQuery(onChange: () => void): () => void {
  const query = darkQuery();
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

export function ColorSchemeThemeProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [colorScheme = "system"] = useAppConfigurationValue<string>(AppSetting.COLOR_SCHEME);
  const systemSetting = useSyncExternalStore(subscribeDarkQuery, () => darkQuery().matches);
  const isDark = colorScheme === "dark" || (colorScheme === "system" && systemSetting);
  return <ThemeProvider isDark={isDark}>{children}</ThemeProvider>;
}
