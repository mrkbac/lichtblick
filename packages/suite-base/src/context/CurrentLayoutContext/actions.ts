// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2020-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { VariableValue } from "@lichtblick/suite";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { LayoutDropPosition, LayoutNode } from "@lichtblick/suite-base/types/layouts";
import {
  PanelConfig,
  PlaybackConfig,
  SavedProps,
  UserScripts,
} from "@lichtblick/suite-base/types/panels";

export type LayoutData = {
  // We store config for each panel in an object keyed by the panel id.
  configById: SavedProps;
  layout?: LayoutNode;
  globalVariables: GlobalVariables;
  playbackConfig: PlaybackConfig;
  userNodes?: UserScripts;
  /** @deprecated renamed to configById */
  savedProps?: SavedProps;
  /**
   * Optional version number. Set this to prevent older incompatible versions of
   * studio trying to load and possibly corrupt the layout.
   */
  version?: number;
};

export type ConfigsPayload = {
  id: string;
  // if you set override to true, existing config will be completely overriden by new passed in config
  override?: boolean;
  config: PanelConfig;
  defaultConfig?: PanelConfig;
};
export type ChangePanelLayoutPayload = {
  layout?: LayoutNode;
  trimConfigById?: boolean;
};
export type SaveConfigsPayload = {
  configs: ConfigsPayload[];
  /** A panel filling in its default config on mount: not a user edit, so not an undo step. */
  fillsDefaults?: boolean;
};

type PerPanelFunc<Config> = (arg0: Config) => Config;
export type SaveFullConfigPayload = {
  panelType: string;
  perPanelFunc: PerPanelFunc<PanelConfig>;
};

export type SAVE_PANEL_CONFIGS = { type: "SAVE_PANEL_CONFIGS"; payload: SaveConfigsPayload };
export type SAVE_FULL_PANEL_CONFIG = {
  type: "SAVE_FULL_PANEL_CONFIG";
  payload: SaveFullConfigPayload;
};
export type CHANGE_PANEL_LAYOUT = {
  type: "CHANGE_PANEL_LAYOUT";
  payload: ChangePanelLayoutPayload;
};

export type OVERWRITE_GLOBAL_DATA = {
  type: "OVERWRITE_GLOBAL_DATA";
  payload: Record<string, VariableValue>;
};

export type SET_GLOBAL_DATA = {
  type: "SET_GLOBAL_DATA";
  payload: Record<string, VariableValue>;
};

export type SET_STUDIO_NODES = { type: "SET_USER_NODES"; payload: Partial<UserScripts> };

export type SET_PLAYBACK_CONFIG = { type: "SET_PLAYBACK_CONFIG"; payload: Partial<PlaybackConfig> };

export type ClosePanelPayload = { id: string };
export type CLOSE_PANEL = { type: "CLOSE_PANEL"; payload: ClosePanelPayload };

export type SplitPanelPayload = {
  id: string;
  direction: "row" | "column";
  config: PanelConfig;
};
export type SPLIT_PANEL = { type: "SPLIT_PANEL"; payload: SplitPanelPayload };

export type SwapPanelPayload = {
  originalId: string;
  type: string;
  config: PanelConfig;
};
export type SWAP_PANEL = { type: "SWAP_PANEL"; payload: SwapPanelPayload };

export type AddPanelPayload = {
  /** id must be formatted as returned by `getPanelIdForType`. This is required as an argument
   * rather than automatically generated because the caller may want to use the new id for
   * something, such as selecting the newly added panel. */
  id: string;
  config?: PanelConfig;
  /** Where to put the panel. Defaults to the left edge of the layout. */
  position?: LayoutDropPosition;
  /** Place the panel relative to the group holding this panel instead of the whole layout. */
  targetPanelId?: string;
};
export type ADD_PANEL = { type: "ADD_PANEL"; payload: AddPanelPayload };

/** Stack panels as tabs into the group of `targetPanelId`. */
export type GroupPanelsPayload = { targetPanelId: string; panelIds: readonly string[] };
export type GROUP_PANELS = { type: "GROUP_PANELS"; payload: GroupPanelsPayload };

export type PanelsActions =
  | CHANGE_PANEL_LAYOUT
  | SAVE_PANEL_CONFIGS
  | SAVE_FULL_PANEL_CONFIG
  | OVERWRITE_GLOBAL_DATA
  | SET_GLOBAL_DATA
  | SET_STUDIO_NODES
  | SET_PLAYBACK_CONFIG
  | CLOSE_PANEL
  | SPLIT_PANEL
  | SWAP_PANEL
  | ADD_PANEL
  | GROUP_PANELS;
