// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Fragment, Suspense, useEffect, useMemo } from "react";

import { IdbLayoutStorage } from "@lichtblick/suite-base/IdbLayoutStorage";
import {
  OrganizationProvider,
  useOrganizationSession,
} from "@lichtblick/suite-base/context/OrganizationContext";
import { useSharedRootContext } from "@lichtblick/suite-base/context/SharedRootContext";
import AlertsContextProvider from "@lichtblick/suite-base/providers/AlertsContextProvider";
import EventsProvider from "@lichtblick/suite-base/providers/EventsProvider";
import LayoutManagerProvider from "@lichtblick/suite-base/providers/LayoutManagerProvider";
import { StudioLogsSettingsProvider } from "@lichtblick/suite-base/providers/StudioLogsSettingsProvider/StudioLogsSettingsProvider";
import TimelineInteractionStateProvider from "@lichtblick/suite-base/providers/TimelineInteractionStateProvider";
import UserProfileLocalStorageProvider from "@lichtblick/suite-base/providers/UserProfileLocalStorageProvider";

import Workspace from "./Workspace";
import DocumentTitleAdapter from "./components/DocumentTitleAdapter";
import MultiProvider from "./components/MultiProvider";
import PlayerManager from "./components/PlayerManager";
import SendNotificationToastAdapter from "./components/SendNotificationToastAdapter";
import StudioToastProvider from "./components/StudioToastProvider";
import { UserScriptStateProvider } from "./context/UserScriptStateContext";
import CurrentLayoutProvider from "./providers/CurrentLayoutProvider";
import ExtensionCatalogProvider from "./providers/ExtensionCatalogProvider/ExtensionCatalogProvider";
import ExtensionMarketplaceProvider from "./providers/ExtensionMarketplaceProvider";
import PanelCatalogProvider from "./providers/PanelCatalogProvider";
import { LaunchPreference } from "./screens/LaunchPreference";

// Suppress context menu for the entire app except on inputs & textareas.
function contextMenuHandler(event: MouseEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }

  event.preventDefault();
  return false;
}

export function StudioApp(): React.JSX.Element {
  const {
    dataSources,
    extensionLoaders,
    layoutLoaders,
    deepLinks,
    enableLaunchPreferenceScreen,
    organizationApiUrl,
    AppBarComponent,
    appBarLeftInset,
    onAppBarDoubleClick,
  } = useSharedRootContext();

  const layoutStorage = useMemo(() => new IdbLayoutStorage(), []);
  const organization = useOrganizationSession(organizationApiUrl);
  const remoteStorage = organization.status === "authenticated" ? organization.storage : undefined;

  const providers = [
    /* eslint-disable react/jsx-key */
    // The logs and toast providers come first so they are available to all downstream providers
    <StudioLogsSettingsProvider />,
    <StudioToastProvider />,
    <OrganizationProvider value={organization} />,
    // The layout manager stores favorites in the user profile, so it is nested inside it.
    <UserProfileLocalStorageProvider />,
    <LayoutManagerProvider
      local={layoutStorage}
      remote={remoteStorage}
      remoteFavorites={remoteStorage}
    />,
    <CurrentLayoutProvider loaders={layoutLoaders} />,
    // Alerts provider also must come before other, dependent contexts.
    <AlertsContextProvider />,
    <TimelineInteractionStateProvider />,
    <ExtensionMarketplaceProvider />,
    <ExtensionCatalogProvider loaders={extensionLoaders} />,
    <UserScriptStateProvider />,
    <PlayerManager playerSources={dataSources} />,
    <EventsProvider />,
    /* eslint-enable react/jsx-key */
  ];

  const MaybeLaunchPreference = enableLaunchPreferenceScreen === true ? LaunchPreference : Fragment;

  useEffect(() => {
    document.addEventListener("contextmenu", contextMenuHandler);
    return () => {
      document.removeEventListener("contextmenu", contextMenuHandler);
    };
  }, []);

  // Only before the first login on this browser (later starts use the cached session): until the
  // session is known, the layout manager would run on the local namespace, and anything created
  // there (Default, sample layouts) would be imported into the account as a "(local)" copy.
  if (organization.status === "loading") {
    return <></>;
  }

  return (
    <MaybeLaunchPreference>
      <MultiProvider providers={providers}>
        <DocumentTitleAdapter />
        <SendNotificationToastAdapter />
        <Suspense fallback={<></>}>
          <PanelCatalogProvider>
            <Workspace
              deepLinks={deepLinks}
              AppBarComponent={AppBarComponent}
              appBarLeftInset={appBarLeftInset}
              onAppBarDoubleClick={onAppBarDoubleClick}
            />
          </PanelCatalogProvider>
        </Suspense>
      </MultiProvider>
    </MaybeLaunchPreference>
  );
}
