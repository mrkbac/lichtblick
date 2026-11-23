// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";

import {
  AppSetting,
  CsvLocalDataSourceFactory,
  FoxgloveWebSocketDataSourceFactory,
  IAppConfiguration,
  McapLocalDataSourceFactory,
  OsContext,
  RemoteDataSourceFactory,
  Ros1LocalBagDataSourceFactory,
  Ros1SocketDataSourceFactory,
  Ros2LocalBagDataSourceFactory,
  RosbridgeDataSourceFactory,
  SampleBoreasDataSourceFactory,
  SharedRoot,
  StudioApp,
  UlogLocalDataSourceFactory,
  VelodyneDataSourceFactory,
} from "@lichtblick/suite-base";

import { DesktopAppBar } from "./DesktopAppBar";
import { DesktopExtensionLoader } from "./services/DesktopExtensionLoader";
import { DesktopLayoutLoader } from "./services/DesktopLayoutLoader";
import { CLIFlags, Desktop, Storage } from "../common/types";

const desktopBridge = (global as unknown as { desktopBridge: Desktop }).desktopBridge;
const storageBridge = (global as unknown as { storageBridge?: Storage }).storageBridge;
const ctxbridge = (global as { ctxbridge?: OsContext }).ctxbridge;

type RootProps = {
  appParameters: CLIFlags;
  appConfiguration: IAppConfiguration;
};

export default function Root(props: RootProps): React.JSX.Element {
  if (!storageBridge) {
    throw new Error("storageBridge is missing");
  }
  const { appConfiguration, appParameters } = props;

  useEffect(() => {
    const handler = () => {
      void desktopBridge.updateNativeColorScheme();
    };

    appConfiguration.addChangeListener(AppSetting.COLOR_SCHEME, handler);
    return () => {
      appConfiguration.removeChangeListener(AppSetting.COLOR_SCHEME, handler);
    };
  }, [appConfiguration]);

  const [extensionLoaders] = useState(() => [new DesktopExtensionLoader(desktopBridge)]);

  const [layoutLoaders] = useState(() => [new DesktopLayoutLoader(desktopBridge)]);

  const [dataSources] = useState(() => [
    new FoxgloveWebSocketDataSourceFactory(),
    new RosbridgeDataSourceFactory(),
    new Ros1SocketDataSourceFactory(),
    new Ros1LocalBagDataSourceFactory(),
    new Ros2LocalBagDataSourceFactory(),
    new UlogLocalDataSourceFactory(),
    new CsvLocalDataSourceFactory(),
    new VelodyneDataSourceFactory(),
    new SampleBoreasDataSourceFactory(),
    new McapLocalDataSourceFactory(),
    new RemoteDataSourceFactory(),
  ]);

  // App url state in window.location will represent the user's current session state
  // better than the initial deep link so we prioritize the current window.location
  // url for startup state. This persists state across user-initiated refreshes.
  const [deepLinks] = useState(() => {
    // We treat presence of the `ds` or `layoutId` params as indicative of active state.
    const windowUrl = new URL(window.location.href);
    const hasActiveURLState =
      windowUrl.searchParams.has("ds") || windowUrl.searchParams.has("layoutId");
    return hasActiveURLState ? [window.location.href] : desktopBridge.getDeepLinks();
  });

  const [isFullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    const unregisterFull = desktopBridge.addIpcEventListener("enter-full-screen", () => {
      setFullScreen(true);
    });
    const unregisterLeave = desktopBridge.addIpcEventListener("leave-full-screen", () => {
      setFullScreen(false);
    });
    return () => {
      unregisterFull();
      unregisterLeave();
    };
  }, []);

  return (
    <SharedRoot
      appParameters={appParameters}
      deepLinks={deepLinks}
      dataSources={dataSources}
      appConfiguration={appConfiguration}
      extensionLoaders={extensionLoaders}
      layoutLoaders={layoutLoaders}
      enableGlobalCss
      AppBarComponent={DesktopAppBar}
      appBarLeftInset={ctxbridge?.platform === "darwin" && !isFullScreen ? 72 : undefined}
      onAppBarDoubleClick={onAppBarDoubleClick}
    >
      <StudioApp />
    </SharedRoot>
  );
}

function onAppBarDoubleClick(): void {
  desktopBridge.handleTitleBarDoubleClick();
}
