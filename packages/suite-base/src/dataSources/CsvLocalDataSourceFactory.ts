// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import { LocalFileDataSourceFactory } from "@lichtblick/suite-base/dataSources/LocalFileDataSourceFactory";

export default class CsvLocalDataSourceFactory extends LocalFileDataSourceFactory {
  public constructor() {
    super({
      id: "csv-local-file",
      displayName: "CSV",
      supportedFileTypes: [AllowedFileExtensions.CSV, AllowedFileExtensions.TSV],
      initWorker: () =>
        new Worker(
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/csv/CsvIterableSourceWorker.worker",
            import.meta.url,
          ),
        ),
      multiFile: true,
    });
  }
}
