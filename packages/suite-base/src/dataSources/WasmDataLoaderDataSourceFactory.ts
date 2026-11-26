// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LocalFileDataSourceFactory } from "@lichtblick/suite-base/dataSources/LocalFileDataSourceFactory";
import { InstalledDataLoader } from "@lichtblick/suite-base/types/Extensions";

/** Opens files of the type an extension's data loader registered for. */
export function createWasmDataLoaderSource({
  extensionId,
  extensionName,
  args,
}: InstalledDataLoader): LocalFileDataSourceFactory {
  return new LocalFileDataSourceFactory({
    // The stable id, not the display name, which two extensions may share
    id: `data-loader:${extensionId}:${args.supportedFileType}`,
    displayName: `${args.supportedFileType} (${extensionName})`,
    supportedFileTypes: [args.supportedFileType],
    initWorker: () =>
      new Worker(
        new URL(
          "@lichtblick/suite-base/players/IterablePlayer/dataLoader/WasmDataLoaderWorker.worker",
          import.meta.url,
        ),
      ),
    serialized: true,
    multiFile: args.supportsMultiFile === true,
    wasmUrl: args.wasmUrl,
  });
}
