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
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { WorkerSerializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/WorkerIterableSource";
import {
  MultiFileHydrationOverrides,
  addMultiFileHydrationOverrides,
} from "@lichtblick/suite-base/players/IterablePlayer/shared/multiFileHydrationOptions";
import { expandVideoSeekBackfill } from "@lichtblick/suite-base/players/IterablePlayer/videoSeekBackfill";
import { Player } from "@lichtblick/suite-base/players/types";

class McapLocalDataSourceFactory implements IDataSourceFactory {
  private readonly multiFileHydrationOverrides?: MultiFileHydrationOverrides;

  public id = "mcap-local-file";
  public type: IDataSourceFactory["type"] = "file";
  public displayName = "MCAP";
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportedFileTypes = [AllowedFileExtensions.MCAP];
  public supportsMultiFile = true;

  // Optional pass-through for future multi-file hydration tuning experiments. Omitted by default
  // so existing behavior remains unchanged until a caller explicitly opts in.
  public constructor(multiFileHydrationOverrides?: MultiFileHydrationOverrides) {
    this.multiFileHydrationOverrides = multiFileHydrationOverrides;
  }

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const files = args.files ?? [];

    if (args.file) {
      files.push(args.file);
    }
    if (files.length === 0) {
      return;
    }

    const source = new WorkerSerializedIterableSource({
      initWorker: () => {
        return new Worker(
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/Mcap/McapIterableSourceWorker.worker",
            import.meta.url,
          ),
        );
      },
      // A single file is opened on its own, so it can follow the file while it grows
      initArgs:
        files.length === 1
          ? { file: files[0], handle: args.handle }
          : addMultiFileHydrationOverrides(
              { files, compare: args.compare },
              this.multiFileHydrationOverrides,
            ),
    });

    return new IterablePlayer({
      source,
      name: files.map((file) => file.name).join(", "),
      sourceId: this.id,
      readAheadDuration: { sec: 120, nsec: 0 },
      // MCAP can carry foxglove.CompressedVideo. Some codecs (e.g. H.265) cannot decode a P/B-frame
      // in isolation, so on a backward seek the backfill is expanded to include the preceding GOP.
      expandBackfill: expandVideoSeekBackfill,
    });
  }
}

export default McapLocalDataSourceFactory;
