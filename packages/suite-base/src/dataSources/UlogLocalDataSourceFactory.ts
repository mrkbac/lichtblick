// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import { LocalFileDataSourceFactory } from "@lichtblick/suite-base/dataSources/LocalFileDataSourceFactory";

export default class UlogLocalDataSourceFactory extends LocalFileDataSourceFactory {
  public constructor() {
    super({
      id: "ulog-local-file",
      displayName: "PX4 ULog",
      supportedFileTypes: [AllowedFileExtensions.ULG, AllowedFileExtensions.ULOG],
      initWorker: () =>
        new Worker(
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/ulog/UlogIterableSourceWorker.worker",
            import.meta.url,
          ),
        ),
    });
  }
}
