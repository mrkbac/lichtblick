// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { produce } from "immer";

import { SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";

import { CameraGridConfig, Rotation, TileConfig, makeTile } from "./types";

export const ADD_ALL_ACTION = "add-all";

const ROTATION_OPTIONS = [0, 90, 180, 270].map((value) => ({ label: `${value}°`, value }));

/** Appends every image topic that isn't shown yet, keeping the sorted order of `imageTopics`. */
export function addAllTopics(config: CameraGridConfig, imageTopics: string[]): CameraGridConfig {
  const existing = new Set(config.tiles.map((tile) => tile.topic));
  const added = imageTopics.filter((topic) => !existing.has(topic)).map(makeTile);
  return added.length === 0 ? config : { ...config, tiles: [...config.tiles, ...added] };
}

export function buildSettingsTree(
  config: CameraGridConfig,
  imageTopics: string[],
): SettingsTreeNodes {
  const shown = new Set(config.tiles.map((tile) => tile.topic));
  const addable = imageTopics.filter((topic) => !shown.has(topic));

  const tiles: SettingsTreeNodes = {};
  config.tiles.forEach((tile, index) => {
    const topicOptions = [tile.topic, ...addable].map((topic) => ({ label: topic, value: topic }));
    tiles[String(index)] = {
      label: tile.topic,
      visible: tile.visible,
      reorderable: true,
      defaultExpansionState: "collapsed",
      actions: [
        ...(index > 0
          ? [{ type: "action" as const, id: "move-up", label: "Move up", icon: "MoveUp" as const }]
          : []),
        ...(index < config.tiles.length - 1
          ? [
              {
                type: "action" as const,
                id: "move-down",
                label: "Move down",
                icon: "MoveDown" as const,
              },
            ]
          : []),
        { type: "action", id: "remove", label: "Remove", icon: "Delete", display: "inline" },
      ],
      fields: {
        topic: { label: "Topic", input: "select", value: tile.topic, options: topicOptions },
        fit: {
          label: "Scaling",
          input: "toggle",
          value: tile.fit,
          options: [
            { label: "Fit", value: "fit" },
            { label: "Fill", value: "fill" },
          ],
        },
        rotation: {
          label: "Rotation",
          input: "select",
          value: tile.rotation,
          options: ROTATION_OPTIONS,
        },
        flipHorizontal: { label: "Flip horizontal", input: "boolean", value: tile.flipHorizontal },
        flipVertical: { label: "Flip vertical", input: "boolean", value: tile.flipVertical },
      },
    };
  });

  return {
    general: {
      label: "General",
      actions: [
        {
          type: "action",
          id: ADD_ALL_ACTION,
          label: "Add all image topics",
          icon: "Grid",
          display: "inline",
        },
        { type: "action", id: "remove-all", label: "Remove all" },
      ],
      fields: {
        add: {
          label: "Add camera",
          input: "select",
          value: undefined,
          tooltip: "Pick an image topic to add it to the grid",
          disabled: addable.length === 0,
          options: addable.map((topic) => ({ label: topic, value: topic })),
        },
        columns: {
          label: "Columns",
          input: "number",
          min: 1,
          step: 1,
          precision: 0,
          placeholder: "Auto",
          value: config.columns,
        },
        showLabels: { label: "Show topic", input: "boolean", value: config.showLabels },
        showTimestamps: { label: "Show timestamp", input: "boolean", value: config.showTimestamps },
      },
    },
    topics: { label: "Cameras", children: tiles },
  };
}

function moveTile(tiles: TileConfig[], from: number, to: number): void {
  const [tile] = tiles.splice(from, 1);
  if (tile) {
    tiles.splice(to, 0, tile);
  }
}

export function settingsReducer(
  config: CameraGridConfig,
  action: SettingsTreeAction,
  imageTopics: string[],
): CameraGridConfig {
  const { path } = action.payload;
  if (action.action === "reorder-node") {
    const from = Number(path[1]);
    const to = Number(action.payload.targetPath[1]);
    return produce(config, (draft) => {
      moveTile(draft.tiles, from, to);
    });
  }
  if (action.action === "perform-node-action") {
    const { id } = action.payload;
    if (id === ADD_ALL_ACTION) {
      return addAllTopics(config, imageTopics);
    }
    if (id === "remove-all") {
      return { ...config, tiles: [] };
    }
  }

  return produce(config, (draft) => {
    if (path[0] === "general" && action.action === "update") {
      const { value } = action.payload;
      switch (path[1]) {
        case "add":
          if (typeof value === "string" && !draft.tiles.some((tile) => tile.topic === value)) {
            draft.tiles.push(makeTile(value));
          }
          break;
        case "columns":
          draft.columns = typeof value === "number" && value >= 1 ? Math.round(value) : undefined;
          break;
        case "showLabels":
        case "showTimestamps":
          draft[path[1]] = value === true;
          break;
      }
      return;
    }

    if (path[0] !== "topics") {
      return;
    }
    const index = Number(path[1]);
    const tile = draft.tiles[index];
    if (!tile) {
      return;
    }

    if (action.action === "perform-node-action") {
      switch (action.payload.id) {
        case "remove":
          draft.tiles.splice(index, 1);
          break;
        case "move-up":
          moveTile(draft.tiles, index, index - 1);
          break;
        case "move-down":
          moveTile(draft.tiles, index, index + 1);
          break;
      }
      return;
    }

    const { value } = action.payload;
    switch (path[2]) {
      case "topic":
        // Each topic is shown at most once, so ignore picking a topic that's already in the grid.
        if (typeof value === "string" && !draft.tiles.some((other) => other.topic === value)) {
          tile.topic = value;
        }
        break;
      case "fit":
        tile.fit = value === "fill" ? "fill" : "fit";
        break;
      case "rotation":
        tile.rotation = ([0, 90, 180, 270].includes(value as number) ? value : 0) as Rotation;
        break;
      case "visible":
      case "flipHorizontal":
      case "flipVertical":
        tile[path[2]] = value === true;
        break;
    }
  });
}
