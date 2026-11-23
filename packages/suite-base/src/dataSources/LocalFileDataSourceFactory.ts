// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { loadIterablePlayer } from "@lichtblick/suite-base/dataSources/playerModules";
import { Player } from "@lichtblick/suite-base/players/types";

type LocalFileOptions = {
  id: string;
  displayName: string;
  supportedFileTypes: AllowedFileExtensions[];
  // Keep `new Worker(new URL("…", import.meta.url))` literal in each caller: the bundler needs it
  initWorker: () => Worker;
  // The worker sends messages still serialized, so they are deserialized on the main thread
  serialized?: boolean;
  // Open every file in one source (initArgs.files) instead of only the first (initArgs.file)
  multiFile?: boolean;
  readAheadDuration?: Time;
};

/** A local file format opened by an iterable source in a worker. */
export class LocalFileDataSourceFactory implements IDataSourceFactory {
  public id: string;
  public type: IDataSourceFactory["type"] = "file";
  public displayName: string;
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportedFileTypes: AllowedFileExtensions[];
  public supportsMultiFile: boolean;
  readonly #options: LocalFileOptions;

  public constructor(options: LocalFileOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.supportedFileTypes = options.supportedFileTypes;
    this.supportsMultiFile = options.multiFile === true;
    this.#options = options;
  }

  public prefetch = loadIterablePlayer;

  public async initialize(args: DataSourceFactoryInitializeArgs): Promise<Player | undefined> {
    const { initWorker, serialized = false, multiFile = false, readAheadDuration } = this.#options;
    const files = (args.files ?? (args.file ? [args.file] : [])).slice(
      0,
      multiFile ? undefined : 1,
    );
    if (!files[0]) {
      return undefined;
    }

    const { IterablePlayer, WorkerIterableSource, WorkerSerializedIterableSource } =
      await loadIterablePlayer();
    const initArgs = multiFile ? { files } : { file: files[0] };
    const source = serialized
      ? new WorkerSerializedIterableSource({ initWorker, initArgs })
      : new WorkerIterableSource({ initWorker, initArgs });

    return new IterablePlayer({
      source,
      name: files.map((file) => file.name).join(", "),
      sourceId: this.id,
      readAheadDuration,
    });
  }
}
