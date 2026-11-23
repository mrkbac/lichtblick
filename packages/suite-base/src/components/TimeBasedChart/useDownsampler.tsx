// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import React, { useMemo, useCallback, useEffect } from "react";
import { useDebouncedCallback } from "use-debounce";

import type { RpcScales } from "@lichtblick/suite-base/components/Chart/types";

import { Downsampler } from "./Downsampler";
import { getBounds } from "./getBounds";
import { ProviderState, PlotViewport, ChartDataset } from "./types";

const EMPTY_BOUNDS = { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } };

/**
 * useDownsampler downsamples the given datasets for the current viewport and
 * returns the latest downsampled data for the TimeBasedChart.
 */
export default function useDownsampler(
  datasets: ChartDataset[],
  view: PlotViewport,
): {
  provided: ProviderState | undefined;
  setScales: (scales: RpcScales) => void;
} {
  const [provided, setProvided] = React.useState<ProviderState | undefined>();

  const downsampler = useMemo(() => new Downsampler(), []);

  // Stable callback to run the downsampler and update the latest copy of the downsampled datasets
  const applyDownsample = useCallback(() => {
    const downsampled = downsampler.downsample();
    if (downsampled == undefined) {
      return;
    }

    setProvided({
      // No plottable points left: still hand over the (empty) datasets so stale data is cleared
      bounds: getBounds(downsampled) ?? EMPTY_BOUNDS,
      data: {
        datasets: downsampled,
      },
    });
  }, [downsampler]);

  // Debounce calls to invoke the downsampler
  const queueDownsample = useDebouncedCallback(
    applyDownsample,
    100,
    // maxWait equal to debounce timeout makes the debounce act like a throttle
    // Without a maxWait - invocations of the debounced invalidate reset the countdown
    // resulting in no invalidation when scales are constantly changing (playback)
    { leading: false, maxWait: 100 },
  );

  const setScales = useCallback(
    (scales: RpcScales) => {
      downsampler.update({ scales });
      queueDownsample();
    },
    [downsampler, queueDownsample],
  );

  // Updates to the dataset bounds do not need to queue a downsample
  useEffect(() => {
    downsampler.update({ datasetBounds: view });
  }, [view, downsampler]);

  // Updates to the viewport or the datasets queue a downsample
  useEffect(() => {
    downsampler.update({ datasets });
    queueDownsample();
  }, [downsampler, datasets, queueDownsample]);

  return { provided, setScales };
}
