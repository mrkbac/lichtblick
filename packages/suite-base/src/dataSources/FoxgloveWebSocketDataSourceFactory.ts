// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { validateWebSocketUrl } from "@lichtblick/suite-base/dataSources/constants";
import { loadFoxgloveWebSocketPlayer } from "@lichtblick/suite-base/dataSources/playerModules";
import { Player } from "@lichtblick/suite-base/players/types";

export default class FoxgloveWebSocketDataSourceFactory implements IDataSourceFactory {
  public id = "foxglove-websocket";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Foxglove WebSocket";
  public iconName: IDataSourceFactory["iconName"] = "Flow";
  public description =
    "Connect to a ROS 1, ROS 2, or custom system using the Foxglove WebSocket protocol. For ROS systems, be sure to first install the foxglove_bridge ROS package.";

  public formConfig = {
    fields: [
      {
        id: "url",
        label: "WebSocket URL",
        defaultValue: "ws://localhost:8765",
        validate: validateWebSocketUrl,
      },
    ],
  };

  public hidden?: boolean;
  public LiveDevices?: IDataSourceFactory["LiveDevices"];
  public prepareTransport?: IDataSourceFactory["prepareTransport"];
  public AccountMenuItems?: IDataSourceFactory["AccountMenuItems"];

  public constructor(
    options?: Pick<
      IDataSourceFactory,
      "id" | "displayName" | "hidden" | "prepareTransport" | "AccountMenuItems" | "LiveDevices"
    >,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  public prefetch = loadFoxgloveWebSocketPlayer;

  public async initialize(args: DataSourceFactoryInitializeArgs): Promise<Player | undefined> {
    const FoxgloveWebSocketPlayer = await loadFoxgloveWebSocketPlayer();
    const url = args.params?.url;
    if (!url) {
      return;
    }

    return new FoxgloveWebSocketPlayer({
      url,
      sourceId: this.id,
      transport: args.transport,
    });
  }
}
