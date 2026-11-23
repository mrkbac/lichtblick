// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { AppBarProps } from "@lichtblick/suite-base/components/AppBar";
import { IAppConfiguration } from "@lichtblick/suite-base/context/AppConfigurationContext";
import { AppParametersInput } from "@lichtblick/suite-base/context/AppParametersContext";
import { IDataSourceFactory } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { LayoutLoader } from "@lichtblick/suite-base/services/ILayoutLoader";
import { IExtensionLoader } from "@lichtblick/suite-base/services/extension/IExtensionLoader";

interface ISharedRootContext {
  deepLinks: readonly string[];
  appConfiguration?: IAppConfiguration;
  appParameters?: AppParametersInput;
  dataSources: IDataSourceFactory[];
  extensionLoaders: readonly IExtensionLoader[];
  layoutLoaders?: readonly LayoutLoader[];
  /** Organization API to sign in to for shared layouts; none when undefined. */
  organizationApiUrl?: string;
  enableLaunchPreferenceScreen?: boolean;
  enableGlobalCss?: boolean;
  AppBarComponent?: (props: AppBarProps) => React.JSX.Element;
  appBarLeftInset?: number;
  onAppBarDoubleClick?: () => void;
}

const SharedRootContext = createContext<ISharedRootContext>({
  deepLinks: [],
  dataSources: [],
  extensionLoaders: [],
});
SharedRootContext.displayName = "SharedRootContext";

export function useSharedRootContext(): ISharedRootContext {
  return useContext(SharedRootContext);
}

export { SharedRootContext };
export type { ISharedRootContext };
