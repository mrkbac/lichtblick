// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DiagnosticId, DiagnosticInfo } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

export type DiagnosticSummaryConfig = {
  minLevel: number;
  pinnedIds: DiagnosticId[];
  /** Topics to read; undefined = every DiagnosticArray topic. */
  topics?: string[];
  /** Legacy single-topic config from older layouts; read as `topics: [topicToRender]`. */
  topicToRender?: string;
  hardwareIdFilter: string;
  sortByLevel?: boolean;
  secondsUntilStale?: number;
  showHistory?: boolean;
};

export type DiagnosticsById = Map<DiagnosticId, DiagnosticInfo>;

export type DiagnosticSummaryProps = {
  config: DiagnosticSummaryConfig;
  saveConfig: SaveConfig<DiagnosticSummaryConfig>;
};
