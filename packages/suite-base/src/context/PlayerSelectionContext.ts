// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { Player } from "@lichtblick/suite-base/players/types";
import { RegisteredIconNames } from "@lichtblick/suite-base/types/Icons";

export type DataSourceFactoryInitializeArgs = {
  file?: File;
  // The handle `file` came from, if any (see IterableSourceInitializeArgs)
  handle?: FileSystemFileHandle;
  files?: File[];
  // Compare `files` side by side instead of merging them into one recording: the side name of
  // each file, in order. Files with the same side name are merged into one side.
  compare?: readonly string[];
  params?: Record<string, string | undefined>;
  sourceMetadata?: Record<string, unknown>[];
};

export type DataSourceFactoryType = "file" | "connection" | "sample";

export type Field = {
  id: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  description?: string;

  /**
   * Optional validate function
   *
   * The function is called with a value and can return an Error if the value should
   * be rejected. If the function returns `undefined`, then the value is accepted.
   */
  validate?: (value: string) => Error | undefined;
};

export interface IDataSourceFactory {
  id: string;

  // A list of alternate ids used to identify this factory
  // https://github.com/foxglove/studio/issues/4937
  legacyIds?: string[];

  type: DataSourceFactoryType;
  displayName: string;
  iconName?: RegisteredIconNames;
  description?: string;
  docsLinks?: { label?: string; url: string }[];
  disabledReason?: string | React.JSX.Element;
  badgeText?: string;
  hidden?: boolean;
  warning?: string | React.JSX.Element;

  sampleLayout?: LayoutData;
  /**
   * Bump when `sampleLayout` changes, so users who opened the sample before get the new layout.
   * Their previous copy is kept, renamed.
   */
  sampleLayoutVersion?: number;

  formConfig?: {
    // Initialization args are populated with keys of the _id_ field
    fields: Field[];
  };

  // If data source initialization supports "Open File" workflow, this property lists the supported
  // file types
  supportedFileTypes?: string[];

  supportsMultiFile?: boolean;

  // Initialize a player.
  initialize: (args: DataSourceFactoryInitializeArgs) => Player | undefined;
}

/**
 * Recently selected source information
 *
 * The _id_ is opaque and up to the PlayerSelectionContext implementation.
 */
export type RecentSource = {
  id: string;
  title: string;
  label?: string;
  sourceId?: string;
  type?: "file" | "connection";
  /** Epoch milliseconds of the last time this source was opened */
  lastOpened?: number;
  pinned?: boolean;
  /** True for the source that is currently open */
  current?: boolean;
};

// File data sources accept either file instances or handles
type FileDataSourceArgs = {
  type: "file";
  files?: File[];
  handles?: FileSystemFileHandle[];
  // Compare the files side by side instead of merging them into one recording: the side name of
  // each file, in order (see DataSourceFactoryInitializeArgs.compare)
  compare?: readonly string[];
};

type ConnectionDataSourceArgs = {
  type: "connection";
  params?: Record<string, string | undefined>;
  sourceMetadata?: Record<string, unknown>[];
};

export type DataSourceArgs = FileDataSourceArgs | ConnectionDataSourceArgs;

/**
 * PlayerSelectionContext exposes the available data sources and a function to set the current data source
 */
export interface PlayerSelection {
  selectSource: (sourceId: string, args?: DataSourceArgs) => void;
  /** Close the current data source (disconnects live connections) */
  closeSource: () => void;
  selectRecent: (recentId: string) => void;
  removeRecent: (recentId: string) => void;
  togglePinRecent: (recentId: string) => void;
  /** Remove all recent sources that are not pinned */
  clearRecents: () => void;

  /** Currently selected data source */
  selectedSource?: IDataSourceFactory;

  /** Local files backing the current data source, if it was opened from files */
  selectedFiles?: readonly File[];

  /** List of available data sources */
  availableSources: readonly IDataSourceFactory[];

  /** Recently selected sources, pinned first then most recent first */
  recentSources: readonly RecentSource[];
}

const PlayerSelectionContext = createContext<PlayerSelection>({
  selectSource: () => {},
  closeSource: () => {},
  selectRecent: () => {},
  removeRecent: () => {},
  togglePinRecent: () => {},
  clearRecents: () => {},
  availableSources: [],
  recentSources: [],
});
PlayerSelectionContext.displayName = "PlayerSelectionContext";

export function usePlayerSelection(): PlayerSelection {
  return useContext(PlayerSelectionContext);
}

export default PlayerSelectionContext;
