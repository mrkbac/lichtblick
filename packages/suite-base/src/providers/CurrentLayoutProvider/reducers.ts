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
  insertPanel,
  removePanels,
  replacePanel,
  setActivePanel,
} from "@lichtblick/suite-base/util/layoutTree";
import {
  findActiveTabTree,
  findLayoutTree,
  getAllPanelIds,
  getLayoutTree,
  isTabPanel,
  mapLayoutTrees,
  setLayoutTree,
} from "@lichtblick/suite-base/util/tabLayout";

export const defaultPlaybackConfig: PlaybackConfig = {
  speed: 1.0,
};

/**
 * Drop the configs of panels that left the layout (including the panels inside tabs), so they
 * don't hang around forever. Keeps the same object when nothing is dropped (moving panels or
 * switching tabs), so config consumers don't re-render.
 */
function trimConfigs(state: LayoutData): LayoutData {
  const panelIds = new Set(getAllPanelIds(state));
  const keepAll = Object.keys(state.configById).every((id) => panelIds.has(id));
  return keepAll ? state : { ...state, configById: _.pick(state.configById, [...panelIds]) };
}

function changePanelLayout(
  state: LayoutData,
  { layout, trimConfigById = true, tab }: ChangePanelLayoutPayload,
): LayoutData {
  const location =
    tab == undefined
      ? { ancestors: [] }
      : { tabPanelId: tab.panelId, tabIndex: tab.index, ancestors: [] };
  const changed = setLayoutTree(state, location, layout);
  return trimConfigById ? trimConfigs(changed) : changed;
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
  return addPanel(withConfig, {
    id: newId,
    position: direction === "row" ? "right" : "bottom",
    targetPanelId: id,
  });
};

const swapPanel = (
  panelsState: LayoutData,
  { originalId, type, config }: SwapPanelPayload,
): LayoutData => {
  const newId = getPanelIdForType(type);
  const withConfig = savePanelConfigs(panelsState, { configs: [{ id: newId, config }] });
  return trimConfigs(mapLayoutTrees(withConfig, (tree) => replacePanel(tree, originalId, newId)));
};

/**
 * Put panel `id` into the layout, or move it there when it already is in the layout (also from
 * the root into a tab and back). The target is the tree holding `targetPanelId`, else the shown
 * tab of `tabId`, else the root.
 */
function addPanel(
  panelsState: LayoutData,
  { id, config, position = "left", targetPanelId, tabId }: AddPanelPayload,
): LayoutData {
  const withConfig = config
    ? savePanelConfigs(panelsState, { configs: [{ id, config }] })
    : panelsState;
  const target = targetPanelId != undefined ? findLayoutTree(withConfig, targetPanelId) : undefined;
  const location = target?.location ??
    (tabId != undefined ? findActiveTabTree(withConfig, tabId)?.location : undefined) ?? {
      ancestors: [],
    };
  // A Tab panel can't go into one of its own tabs.
  if (location.ancestors.includes(id) || location.tabPanelId === id) {
    return panelsState;
  }
  const removed = mapLayoutTrees(withConfig, (tree) => removePanels(tree, [id]));
  const tree = insertPanel(
    getLayoutTree(removed, location),
    id,
    position,
    target != undefined ? targetPanelId : undefined,
  );
  return trimConfigs(setLayoutTree(removed, location, tree));
}

/** Move `panelIds` into the group holding `targetPanelId` as tabs. */
function groupPanels(
  panelsState: LayoutData,
  targetPanelId: string,
  panelIds: readonly string[],
): LayoutData {
  // Selections can outlive their panels; ignore ids that are no longer in the layout.
  const present = new Set(getAllPanelIds(panelsState));
  if (!present.has(targetPanelId)) {
    return panelsState;
  }
  let result = panelsState;
  for (const id of panelIds) {
    if (id !== targetPanelId && present.has(id)) {
      result = addPanel(result, { id, position: "center", targetPanelId });
    }
  }
  const target = findLayoutTree(result, targetPanelId);
  return target == undefined
    ? result
    : setLayoutTree(result, target.location, setActivePanel(target.tree, targetPanelId));
}

export default function (panelsState: Readonly<LayoutData>, action: PanelsActions): LayoutData {
  // start the newPanelsState as the current panels state so if there are no changes the identity
  // of the panels state object remains the same
  switch (action.type) {
    case "CHANGE_PANEL_LAYOUT":
      return changePanelLayout(panelsState, action.payload);

    case "SAVE_PANEL_CONFIGS": {
      const saved = savePanelConfigs(panelsState, action.payload);
      // Removing a tab of a Tab panel removes the panels in it.
      return action.payload.configs.some(({ id }) => isTabPanel(id)) ? trimConfigs(saved) : saved;
    }

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
      return trimConfigs(
        mapLayoutTrees(panelsState, (tree) => removePanels(tree, [action.payload.id])),
      );

    case "SPLIT_PANEL":
      return splitPanel(panelsState, action.payload);

    case "SWAP_PANEL":
      return swapPanel(panelsState, action.payload);

    case "ADD_PANEL":
      return addPanel(panelsState, action.payload);

    case "GROUP_PANELS":
      return groupPanels(panelsState, action.payload.targetPanelId, action.payload.panelIds);

    default:
      throw new Error("This reducer should only be used for panel actions");
  }

  return panelsState;
}
