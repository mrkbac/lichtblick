// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { ChartDataset } from "chart.js";
import { useEffect, useState } from "react";

import { iterateObjects } from "@lichtblick/suite-base/components/Chart/datasets";
import type { ObjectData } from "@lichtblick/suite-base/components/Chart/types";

import { PlotDataProvider, ProviderState, Bounds, PlotViewport } from "./types";

export function getBounds(data: ChartDataset<"scatter", ObjectData>[]): Bounds | undefined {
  let xMin: number | undefined;
  let xMax: number | undefined;
  let yMin: number | undefined;
  let yMax: number | undefined;

  for (const dataset of data) {
    for (const item of iterateObjects(dataset.data)) {
      if (!isNaN(item.x)) {
        xMin = Math.min(xMin ?? item.x, item.x);
        xMax = Math.max(xMax ?? item.x, item.x);
      }

      if (!isNaN(item.y)) {
        yMin = Math.min(yMin ?? item.y, item.y);
        yMax = Math.max(yMax ?? item.y, item.y);
      }
    }
  }

  if (xMin == undefined || xMax == undefined || yMin == undefined || yMax == undefined) {
    return undefined;
  }

  return { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
}

export default function useProvider(
  view: PlotViewport,
  provider: PlotDataProvider,
): ProviderState | undefined {
  const [state, setState] = useState<ProviderState | undefined>();

  useEffect(() => {
    provider.register(setState);
  }, [provider]);

  useEffect(() => {
    provider.setView(view);
  }, [provider, view]);

  return state;
}
