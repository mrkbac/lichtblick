// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { loadIterablePlayer } from "@lichtblick/suite-base/dataSources/playerModules";
import { createMcapSourceWorker } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/createMcapSourceWorker";
import { Player } from "@lichtblick/suite-base/players/types";
import { recordingName } from "@lichtblick/suite-base/util/compareSides";

class McapLocalDataSourceFactory implements IDataSourceFactory {
  public id = "mcap-local-file";
  public type: IDataSourceFactory["type"] = "file";
  public displayName = "MCAP";
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportedFileTypes = [AllowedFileExtensions.MCAP];
  public supportsMultiFile = true;
  public supportsCompare = true;

  public prefetch = loadIterablePlayer;

  public async initialize(args: DataSourceFactoryInitializeArgs): Promise<Player | undefined> {
    const { IterablePlayer, WorkerSerializedIterableSource, expandVideoSeekBackfill } =
      await loadIterablePlayer();
    const files = args.files ?? [];

    if (args.file) {
      files.push(args.file);
    }
    const { recordings } = args;
    if (files.length === 0 && recordings == undefined) {
      return;
    }

    const source = new WorkerSerializedIterableSource({
      initWorker: createMcapSourceWorker,
      // A single file is opened on its own, so it can follow the file while it grows
      initArgs: recordings
        ? { recordings, compare: args.compare }
        : files.length === 1
          ? { file: files[0], handle: args.handle }
          : { files, compare: args.compare },
    });

    return new IterablePlayer({
      source,
      name: (recordings ?? files).map(recordingName).join(", "),
      sourceId: this.id,
      readAheadDuration: { sec: 120, nsec: 0 },
      // MCAP can carry foxglove.CompressedVideo. Some codecs (e.g. H.265) cannot decode a P/B-frame
      // in isolation, so on a backward seek the backfill is expanded to include the preceding GOP.
      expandBackfill: expandVideoSeekBackfill,
    });
  }
}

export default McapLocalDataSourceFactory;
