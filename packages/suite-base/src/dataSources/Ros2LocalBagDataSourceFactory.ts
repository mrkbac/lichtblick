// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import { LocalFileDataSourceFactory } from "@lichtblick/suite-base/dataSources/LocalFileDataSourceFactory";

export default class Ros2LocalBagDataSourceFactory extends LocalFileDataSourceFactory {
  public constructor() {
    super({
      id: "ros2-local-bagfile",
      displayName: "ROS 2 Bag",
      supportedFileTypes: [AllowedFileExtensions.DB3],
      initWorker: () =>
        new Worker(
          new URL(
            "@lichtblick/suite-base/players/IterablePlayer/rosdb3/RosDb3IterableSourceWorker.worker",
            import.meta.url,
          ),
        ),
      serialized: true,
      multiFile: true,
      readAheadDuration: { sec: 120, nsec: 0 },
    });
  }
}
