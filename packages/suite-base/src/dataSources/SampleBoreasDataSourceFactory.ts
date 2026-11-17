// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IDataSourceFactory } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  SAMPLE_BOREAS_DATA_SOURCE_DISPLAY_NAME,
  SAMPLE_BOREAS_DATA_SOURCE_ICON_NAME,
  SAMPLE_BOREAS_DATA_SOURCE_ID,
  SAMPLE_BOREAS_DATA_SOURCE_NAME,
  SAMPLE_BOREAS_DATA_SOURCE_READ_AHEAD_DURATION,
  SAMPLE_BOREAS_DATA_SOURCE_TYPE,
  SAMPLE_BOREAS_DATA_SOURCE_URL,
} from "@lichtblick/suite-base/dataSources/constants";
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { WorkerSerializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource";
import { expandVideoSeekBackfill } from "@lichtblick/suite-base/players/IterablePlayer/videoSeekBackfill";

import SampleBoreasLayout from "./SampleBoreasLayout.json";

class SampleBoreasDataSourceFactory implements IDataSourceFactory {
  public id = SAMPLE_BOREAS_DATA_SOURCE_ID;
  // Links and recents saved for the nuScenes sample this replaced open this one.
  public legacyIds = ["sample-nuscenes"];
  public type: IDataSourceFactory["type"] = SAMPLE_BOREAS_DATA_SOURCE_TYPE;
  public displayName = SAMPLE_BOREAS_DATA_SOURCE_DISPLAY_NAME;
  public iconName: IDataSourceFactory["iconName"] = SAMPLE_BOREAS_DATA_SOURCE_ICON_NAME;
  public hidden = true;
  public sampleLayout = SampleBoreasLayout as IDataSourceFactory["sampleLayout"];
  // Bump when SampleBoreasLayout.json changes so saved copies are replaced. 2: acceleration slider.
  public sampleLayoutVersion = 2;

  public initialize(): ReturnType<IDataSourceFactory["initialize"]> {
    const bagUrl = SAMPLE_BOREAS_DATA_SOURCE_URL;

    const source = new WorkerSerializedIterableSource({
      initWorker: () => {
        return new Worker(
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/Mcap/McapIterableSourceWorker.worker",
            import.meta.url,
          ),
        );
      },
      initArgs: { url: bagUrl },
    });

    return new IterablePlayer({
      source,
      name: SAMPLE_BOREAS_DATA_SOURCE_NAME,
      // Use blank url params so the data source is set in the url
      urlParams: {},
      sourceId: this.id,
      readAheadDuration: SAMPLE_BOREAS_DATA_SOURCE_READ_AHEAD_DURATION,
      // The sample's camera is H.265 foxglove.CompressedVideo, which
      // cannot decode a P/B-frame in isolation, so on a backward seek the backfill is expanded to
      // include the preceding GOP.
      expandBackfill: expandVideoSeekBackfill,
    });
  }
}

export default SampleBoreasDataSourceFactory;
