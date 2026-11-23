// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IDataSourceFactory } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { loadIterablePlayer } from "@lichtblick/suite-base/dataSources/playerModules";
import { createMcapSourceWorker } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/createMcapSourceWorker";
import { Player } from "@lichtblick/suite-base/players/types";

import SampleBoreasLayout from "./SampleBoreasLayout.json";

// Streamed with HTTP range requests; the host must allow CORS GET/HEAD with a Range header.
// Rebuild the file with `uv run ci/create-boreas-showcase.py`.
const SAMPLE_URL = "https://pub-28ff7cafca60457aa0fb10e79c70ff4b.r2.dev/boreas-showcase-v2.mcap";

class SampleBoreasDataSourceFactory implements IDataSourceFactory {
  public id = "sample-boreas";
  // Links and recents saved for the nuScenes sample this replaced open this one.
  public legacyIds = ["sample-nuscenes"];
  public type: IDataSourceFactory["type"] = "sample";
  public displayName = "Sample: Boreas";
  public iconName: IDataSourceFactory["iconName"] = "FileASPX";
  public hidden = true;
  public sampleLayout = SampleBoreasLayout as IDataSourceFactory["sampleLayout"];
  // Bump when SampleBoreasLayout.json changes so saved copies are replaced. 2: acceleration slider.
  public sampleLayoutVersion = 2;

  public prefetch = loadIterablePlayer;

  public async initialize(): Promise<Player | undefined> {
    const { IterablePlayer, WorkerSerializedIterableSource, expandVideoSeekBackfill } =
      await loadIterablePlayer();
    const source = new WorkerSerializedIterableSource({
      initWorker: createMcapSourceWorker,
      initArgs: { url: SAMPLE_URL },
    });

    return new IterablePlayer({
      source,
      name: "Adapted from the Boreas dataset, Keenan Burnett et al., University of Toronto. CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ · https://www.boreas.utias.utoronto.ca/",
      // Use blank url params so the data source is set in the url
      urlParams: {},
      sourceId: this.id,
      readAheadDuration: { sec: 10, nsec: 0 },
      // The sample's camera is H.265 foxglove.CompressedVideo, which
      // cannot decode a P/B-frame in isolation, so on a backward seek the backfill is expanded to
      // include the preceding GOP.
      expandBackfill: expandVideoSeekBackfill,
    });
  }
}

export default SampleBoreasDataSourceFactory;
