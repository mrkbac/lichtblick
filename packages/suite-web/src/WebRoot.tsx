// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { lazy, Suspense, useMemo, useState } from "react";

import {
  AppSetting,
  CsvLocalDataSourceFactory,
  IExtensionLoader,
  FoxgloveWebSocketDataSourceFactory,
  WebExtensionLoader,
  McapLocalDataSourceFactory,
  RemoteDataSourceFactory,
  Ros1LocalBagDataSourceFactory,
  Ros2LocalBagDataSourceFactory,
  RosbridgeDataSourceFactory,
  SampleBoreasDataSourceFactory,
  SharedRoot,
  UlogLocalDataSourceFactory,
} from "@lichtblick/suite-base";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { AppParametersInput } from "@lichtblick/suite-base/context/AppParametersContext";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const TailscaleDevices = lazy(async () => await import("./tailscale/TailscaleDevices"));
const TailscaleMenu = lazy(async () => await import("./tailscale/TailscaleMenu"));

const isDevelopment = process.env.NODE_ENV === "development";

/** Configures browser services and keeps protocol callbacks inside the installed web app. */
export function WebRoot(props: { children: React.JSX.Element }): React.JSX.Element {
  const appConfiguration = useMemo(
    () =>
      new LocalStorageAppConfiguration({
        defaults: {
          [AppSetting.SHOW_DEBUG_PANELS]: isDevelopment,
        },
      }),
    [],
  );

  const url = new URL(globalThis.location.href);
  const [isProtocolLaunch] = useState(() => url.searchParams.has("protocol"));
  const [extensionLoaders] = useState<IExtensionLoader[]>(() => [new WebExtensionLoader()]);

  const layout = url.searchParams.get("layout");
  const [appParameters] = useState<AppParametersInput>(() => {
    const params: Record<string, string> = {};
    if (layout != undefined && layout !== "") {
      params.defaultLayout = layout;
    }
    return params;
  });

  const [dataSources] = useState(() => [
    new Ros1LocalBagDataSourceFactory(),
    new Ros2LocalBagDataSourceFactory(),
    new FoxgloveWebSocketDataSourceFactory(),
    new FoxgloveWebSocketDataSourceFactory({
      id: "tailscale",
      displayName: sharedI18nObject.t("openDialog:tailscaleConnect"),
      hidden: true,
      prepareTransport: async (signal) => {
        const { prepareTailscaleTransport } = await import("./tailscale/TailscaleAccount");
        return await prepareTailscaleTransport(signal);
      },
      LiveDevices: (deviceProps) => (
        <Suspense fallback={null}>
          <TailscaleDevices {...deviceProps} />
        </Suspense>
      ),
      AccountMenuItems: (menuProps) => (
        <Suspense fallback={null}>
          <TailscaleMenu {...menuProps} />
        </Suspense>
      ),
    }),
    new RosbridgeDataSourceFactory(),
    new UlogLocalDataSourceFactory(),
    new CsvLocalDataSourceFactory(),
    new SampleBoreasDataSourceFactory(),
    new McapLocalDataSourceFactory(),
    new RemoteDataSourceFactory(),
  ]);

  return (
    <SharedRoot
      enableLaunchPreferenceScreen={!isProtocolLaunch}
      deepLinks={[globalThis.location.href]}
      dataSources={dataSources}
      appConfiguration={appConfiguration}
      appParameters={appParameters}
      extensionLoaders={extensionLoaders}
      organizationApiUrl={APP_CONFIG.apiUrl}
      enableGlobalCss
    >
      {props.children}
    </SharedRoot>
  );
}
