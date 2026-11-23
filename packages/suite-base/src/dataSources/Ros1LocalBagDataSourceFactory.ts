// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import { LocalFileDataSourceFactory } from "@lichtblick/suite-base/dataSources/LocalFileDataSourceFactory";

export default class Ros1LocalBagDataSourceFactory extends LocalFileDataSourceFactory {
  public constructor() {
    super({
      id: "ros1-local-bagfile",
      displayName: "ROS 1 Bag",
      supportedFileTypes: [AllowedFileExtensions.BAG],
      initWorker: () =>
        new Worker(
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/BagIterableSourceWorker.worker",
            import.meta.url,
          ),
        ),
      serialized: true,
      readAheadDuration: { sec: 120, nsec: 0 },
    });
  }
}
