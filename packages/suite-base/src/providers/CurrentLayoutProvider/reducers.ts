// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import * as _ from "lodash-es";

import {
  AddPanelPayload,
  ChangePanelLayoutPayload,
  LayoutData,
  PanelsActions,
  SaveConfigsPayload,
  SaveFullConfigPayload,
  SplitPanelPayload,
  SwapPanelPayload,
} from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { PlaybackConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelIdForType, getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import {
  getPanelIds,
  groupPanels,
  insertPanel,
  normalizeLayout,
  removePanels,
  replacePanel,
} from "@lichtblick/suite-base/util/layoutTree";

export const defaultPlaybackConfig: PlaybackConfig = {
  speed: 1.0,
};

function changePanelLayout(
  state: LayoutData,
  { layout, trimConfigById = true }: ChangePanelLayoutPayload,
): LayoutData {
  const normalized = normalizeLayout(layout);
  // Drop the configs of panels that left the layout, so they don't hang around forever
  const configById = trimConfigById
    ? _.pick(state.configById, getPanelIds(normalized))
    : state.configById;
  return { ...state, configById, layout: normalized };
}

function savePanelConfigs(state: LayoutData, payload: SaveConfigsPayload): LayoutData {
  const { configs } = payload;
  const prevConfigById = state.configById;

  // create a configById object with new configs merged on top of previous configs
  //
  // Note: If no configs are changed, the return value of newConfigById is the same as the state input
  //       This keeps the state object unchagned if the configs values did not change.
  const newConfigById = configs.reduce(
    (currentSavedProps, { id, config, defaultConfig = {}, override = false }) => {
      if (override) {
        return { ...currentSavedProps, [id]: config };
      }

      const oldConfig = currentSavedProps[id];
      const newConfig = {
        // merge the partial new config with the default config and the old config
        // any entries in the new config can override default config and previous config entries
        ...defaultConfig,
        ...currentSavedProps[id],
        ...config,
      };

      // if the new config is unchanged, return currentSavedProps to keep same object
      // keeping the same object around is useful for upstream consumers of state which look at changes
      // in object reference to mean the object changed
      if (_.isEqual(oldConfig, newConfig)) {
        return currentSavedProps;
      }

      return { ...currentSavedProps, [id]: newConfig };
    },
    state.configById,
  );
  // if none of the configs changed, then we keep the same state object
  if (prevConfigById === newConfigById) {
    return state;
  }
  return { ...state, configById: newConfigById };
}

function saveFullPanelConfig(state: LayoutData, payload: SaveFullConfigPayload): LayoutData {
  const { panelType, perPanelFunc } = payload;
  const newProps = { ...state.configById };
  const fullConfig = state.configById;
  for (const [panelId, panelConfig] of Object.entries(fullConfig)) {
    if (getPanelTypeFromId(panelId) === panelType) {
      newProps[panelId] = perPanelFunc(panelConfig);
    }
  }

  return { ...state, configById: newProps };
}

const splitPanel = (
  panelsState: LayoutData,
  { id, direction, config }: SplitPanelPayload,
): LayoutData => {
  const newId = getPanelIdForType(getPanelTypeFromId(id));
  const withConfig = savePanelConfigs(panelsState, { configs: [{ id: newId, config }] });
  return changePanelLayout(withConfig, {
    layout: insertPanel(panelsState.layout, newId, direction === "row" ? "right" : "bottom", id),
  });
};

const swapPanel = (
  panelsState: LayoutData,
  { originalId, type, config }: SwapPanelPayload,
): LayoutData => {
  const newId = getPanelIdForType(type);
  const withConfig = savePanelConfigs(panelsState, { configs: [{ id: newId, config }] });
  return changePanelLayout(withConfig, {
    layout: replacePanel(panelsState.layout, originalId, newId),
  });
};

const addPanel = (
  panelsState: LayoutData,
  { id, config, position = "left", targetPanelId }: AddPanelPayload,
): LayoutData => {
  const withConfig = config
    ? savePanelConfigs(panelsState, { configs: [{ id, config }] })
    : panelsState;
  return changePanelLayout(withConfig, {
    layout: insertPanel(panelsState.layout, id, position, targetPanelId),
  });
};

export default function (panelsState: Readonly<LayoutData>, action: PanelsActions): LayoutData {
  // start the newPanelsState as the current panels state so if there are no changes the identity
  // of the panels state object remains the same
  switch (action.type) {
    case "CHANGE_PANEL_LAYOUT":
      return changePanelLayout(panelsState, action.payload);

    case "SAVE_PANEL_CONFIGS":
      return savePanelConfigs(panelsState, action.payload);

    case "SAVE_FULL_PANEL_CONFIG":
      return saveFullPanelConfig(panelsState, action.payload);

    case "OVERWRITE_GLOBAL_DATA":
      return {
        ...panelsState,
        globalVariables: action.payload,
      };

    case "SET_GLOBAL_DATA": {
      const globalVariables = {
        ...panelsState.globalVariables,
        ...action.payload,
      };
      Object.keys(globalVariables).forEach((key) => {
        if (globalVariables[key] == undefined) {
          delete globalVariables[key];
        }
      });
      return {
        ...panelsState,
        globalVariables,
      };
    }

    case "SET_USER_NODES": {
      const userNodes = { ...panelsState.userNodes };
      for (const [key, value] of Object.entries(action.payload)) {
        if (value == undefined) {
          delete userNodes[key];
        } else {
          userNodes[key] = value;
        }
      }
      return {
        ...panelsState,
        userNodes,
      };
    }

    case "SET_PLAYBACK_CONFIG":
      return {
        ...panelsState,
        playbackConfig: {
          ...panelsState.playbackConfig,
          ...action.payload,
        },
      };
    case "CLOSE_PANEL":
      return changePanelLayout(panelsState, {
        layout: removePanels(panelsState.layout, [action.payload.id]),
      });

    case "SPLIT_PANEL":
      return splitPanel(panelsState, action.payload);

    case "SWAP_PANEL":
      return swapPanel(panelsState, action.payload);

    case "ADD_PANEL":
      return addPanel(panelsState, action.payload);

    case "GROUP_PANELS":
      return changePanelLayout(panelsState, {
        layout: groupPanels(
          panelsState.layout,
          action.payload.targetPanelId,
          action.payload.panelIds,
        ),
      });

    default:
      throw new Error("This reducer should only be used for panel actions");
  }

  return panelsState;
}
