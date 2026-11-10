// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";
import { produce } from "immer";

import { SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";
import { sortPrefixMatchesToFront } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/topicPrefixMatching";
import { moveItem, moveUpDownActions } from "@lichtblick/suite-base/panels/utils";

import { tileAnnotationTopics } from "./annotations";
import { CameraGridConfig, Rotation, makeTile } from "./types";

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
  annotationTopics: string[],
  t: TFunction<"cameraGrid">,
): SettingsTreeNodes {
  const shown = new Set(config.tiles.map((tile) => tile.topic));
  const addable = imageTopics.filter((topic) => !shown.has(topic));

  const tiles: SettingsTreeNodes = {};
  config.tiles.forEach((tile, index) => {
    const topicOptions = [tile.topic, ...addable].map((topic) => ({ label: topic, value: topic }));
    const shownAnnotations = new Set(tileAnnotationTopics(tile, annotationTopics));
    // Same order as the Image panel: topics next to the image topic first.
    const annotationOptions = [...annotationTopics];
    sortPrefixMatchesToFront(annotationOptions, tile.topic, (topic) => topic);
    const annotationNodes: SettingsTreeNodes = {};
    for (const topic of annotationOptions) {
      annotationNodes[topic] = { label: topic, visible: shownAnnotations.has(topic) };
    }
    tiles[String(index)] = {
      label: tile.topic,
      visible: tile.visible,
      reorderable: true,
      defaultExpansionState: "collapsed",
      actions: [
        ...moveUpDownActions(index, config.tiles.length, { up: t("moveUp"), down: t("moveDown") }),
        { type: "action", id: "remove", label: t("remove"), icon: "Delete", display: "inline" },
      ],
      fields: {
        topic: { label: t("topic"), input: "select", value: tile.topic, options: topicOptions },
        fit: {
          label: t("scaling"),
          input: "toggle",
          value: tile.fit,
          options: [
            { label: t("scalingFit"), value: "fit" },
            { label: t("scalingFill"), value: "fill" },
          ],
        },
        rotation: {
          label: t("rotation"),
          input: "select",
          value: tile.rotation,
          options: ROTATION_OPTIONS,
        },
        flipHorizontal: {
          label: t("flipHorizontal"),
          input: "boolean",
          value: tile.flipHorizontal,
        },
        flipVertical: { label: t("flipVertical"), input: "boolean", value: tile.flipVertical },
      },
      children:
        annotationOptions.length > 0
          ? {
              annotations: {
                label: t("annotations"),
                enableVisibilityFilter: true,
                children: annotationNodes,
              },
            }
          : undefined,
    };
  });

  return {
    general: {
      label: t("general"),
      actions: [
        {
          type: "action",
          id: ADD_ALL_ACTION,
          label: t("addAllImageTopics"),
          icon: "Grid",
          display: "inline",
        },
        { type: "action", id: "remove-all", label: t("removeAll") },
      ],
      fields: {
        add: {
          label: t("addCamera"),
          input: "select",
          value: undefined,
          tooltip: t("addCameraTooltip"),
          disabled: addable.length === 0,
          options: addable.map((topic) => ({ label: topic, value: topic })),
        },
        columns: {
          label: t("columns"),
          input: "number",
          min: 1,
          step: 1,
          precision: 0,
          placeholder: t("columnsAuto"),
          value: config.columns,
        },
        showLabels: { label: t("showTopic"), input: "boolean", value: config.showLabels },
        showTimestamps: {
          label: t("showTimestamp"),
          input: "boolean",
          value: config.showTimestamps,
        },
        linkZoom: {
          label: t("linkZoom"),
          input: "boolean",
          value: config.linkZoom,
          help: t("linkZoomHelp"),
        },
        syncAnnotations: {
          label: t("syncAnnotations"),
          input: "boolean",
          value: config.syncAnnotations,
          help: t("syncAnnotationsHelp"),
        },
      },
    },
    topics: { label: t("cameras"), children: tiles },
  };
}

export function settingsReducer(
  config: CameraGridConfig,
  action: SettingsTreeAction,
  /** Topics "Add all" appends; raw images are left out by the caller. */
  addAllTopicNames: string[],
  annotationTopics: string[] = [],
): CameraGridConfig {
  const { path } = action.payload;
  if (action.action === "reorder-node") {
    const from = Number(path[1]);
    const to = Number(action.payload.targetPath[1]);
    return produce(config, (draft) => {
      moveItem(draft.tiles, from, to);
    });
  }
  if (action.action === "perform-node-action") {
    const { id } = action.payload;
    if (id === ADD_ALL_ACTION) {
      return addAllTopics(config, addAllTopicNames);
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
        case "linkZoom":
        case "syncAnnotations":
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
          moveItem(draft.tiles, index, index - 1);
          break;
        case "move-down":
          moveItem(draft.tiles, index, index + 1);
          break;
      }
      return;
    }

    const { value } = action.payload;
    if (path[2] === "annotations" && path[3] != undefined && path[4] === "visible") {
      // The first toggle turns the automatic match into the tile's own list.
      const topic = path[3];
      const shown = tileAnnotationTopics(tile, annotationTopics).filter((other) => other !== topic);
      tile.annotationTopics = value === true ? [...shown, topic] : shown;
      return;
    }
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
