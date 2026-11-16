// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2024-2025 Yukihiro Saito <yukky.saito@gmail.com>
// SPDX-License-Identifier: MPL-2.0
import { useMemo } from "react";

import { useShallowMemo } from "@lichtblick/hooks";

import { buildSettingsTree } from "./settings";
import type { PieChartConfig } from "./types";
import type { DocumentedNodes } from "../shared/documentedSettings";

export type UseSettingsTreeProps = {
  config: PieChartConfig;
  pathParseError?: string;
  error?: string;
  legendCount: number;
};

export function useSettingsTree({
  config,
  pathParseError,
  error,
  legendCount,
}: UseSettingsTreeProps): DocumentedNodes {
  const general = useMemo(
    () => buildSettingsTree(config, legendCount, pathParseError, error).general,
    [config, pathParseError, error, legendCount],
  );
  return useShallowMemo({ general });
}
