// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  IterablePlayer,
  WorkerIterableSource,
} from "@lichtblick/suite-base/players/IterablePlayer";
import { Player } from "@lichtblick/suite-base/players/types";

class CsvLocalDataSourceFactory implements IDataSourceFactory {
  public id = "csv-local-file";
  public type: IDataSourceFactory["type"] = "file";
  public displayName = "CSV";
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportedFileTypes = [AllowedFileExtensions.CSV, AllowedFileExtensions.TSV];
  public supportsMultiFile = true;

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const files = args.files ?? (args.file ? [args.file] : []);
    if (files.length === 0) {
      return;
    }

    const source = new WorkerIterableSource({
      initWorker: () => {
        return new Worker(
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/csv/CsvIterableSourceWorker.worker",
            import.meta.url,
          ),
        );
      },
      initArgs: { files },
    });

    return new IterablePlayer({
      source,
      name: files.map((file) => file.name).join(", "),
      sourceId: this.id,
    });
  }
}

export default CsvLocalDataSourceFactory;
