// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import type { OpenSiblingPanel, PanelConfig } from "@lichtblick/suite-base/types/panels";

import type { PlotConfig } from "./config";

/** Adds one path, or several (e.g. the fields of a message), to the Plot next to the panel. */
export function openSiblingPlotPanel(
  openSiblingPanel: OpenSiblingPanel,
  paths: string | readonly string[],
): void {
  openSiblingPanel({
    panelType: "Plot",
    updateIfExists: true,
    siblingConfigCreator: (config: PanelConfig) => {
      return {
        ...config,
        paths: _.uniqBy(
          [
            ...(config as PlotConfig).paths,
            ...(typeof paths === "string" ? [paths] : paths).map((value) => ({
              value,
              enabled: true,
              timestampMethod: "receiveTime" as const,
            })),
          ],
          "value",
        ),
      };
    },
  });
}
