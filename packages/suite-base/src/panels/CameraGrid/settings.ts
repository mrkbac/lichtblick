// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";
import { produce } from "immer";

import { SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";
import { sortPrefixMatchesToFront } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/topicPrefixMatching";
import { showHideAllValue, topicListNode } from "@lichtblick/suite-base/panels/shared/topicList";
import { moveItem, moveUpDownActions } from "@lichtblick/suite-base/panels/utils";

import { tileAnnotationTopics } from "./annotations";
import { CameraGridConfig, Rotation, makeTile } from "./types";

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
  const tiles: SettingsTreeNodes = {};
  config.tiles.forEach((tile, index) => {
    const shownAnnotations = new Set(tileAnnotationTopics(tile, annotationTopics));
    // Same order as the Image panel: topics next to the image topic first.
    const annotationOptions = [...annotationTopics];
    sortPrefixMatchesToFront(annotationOptions, tile.topic, (topic) => topic);
    const annotationNodes: SettingsTreeNodes = {};
    for (const topic of annotationOptions) {
      annotationNodes[topic] = { label: topic, visible: shownAnnotations.has(topic) };
    }
    tiles[tile.topic] = {
      label: tile.topic,
      visible: tile.visible,
      reorderable: true,
      defaultExpansionState: "collapsed",
      actions: moveUpDownActions(index, config.tiles.length, {
        up: t("moveUp"),
        down: t("moveDown"),
      }),
      fields: {
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
  // Image topics without a tile yet; turning one on adds it to the end of the grid.
  for (const topic of imageTopics) {
    tiles[topic] ??= { label: topic, visible: false };
  }

  return {
    general: {
      label: t("general"),
      fields: {
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
    topics: topicListNode({ label: t("cameras"), children: tiles }),
  };
}

export function settingsReducer(
  config: CameraGridConfig,
  action: SettingsTreeAction,
  /** Topics "Show all" adds tiles for; raw images are left out by the caller. */
  addAllTopicNames: string[],
  annotationTopics: string[] = [],
): CameraGridConfig {
  const { path } = action.payload;
  const tileIndex = (topic: string | undefined) =>
    config.tiles.findIndex((tile) => tile.topic === topic);
  if (action.action === "reorder-node") {
    const from = tileIndex(path[1]);
    const to = tileIndex(action.payload.targetPath[1]);
    if (from < 0 || to < 0) {
      return config;
    }
    return produce(config, (draft) => {
      moveItem(draft.tiles, from, to);
    });
  }
  const showAll = showHideAllValue(action);
  if (showAll != undefined && path.length === 1 && path[0] === "topics") {
    const tiles = config.tiles.map((tile) => ({ ...tile, visible: showAll }));
    return addAllTopics({ ...config, tiles }, showAll ? addAllTopicNames : []);
  }

  return produce(config, (draft) => {
    if (path[0] === "general" && action.action === "update") {
      const { value } = action.payload;
      switch (path[1]) {
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
    const index = tileIndex(path[1]);
    const tile = draft.tiles[index];
    if (!tile) {
      // Turning on an image topic that has no tile yet adds one.
      if (action.action === "update" && path[1] != undefined && path[2] === "visible") {
        if (action.payload.value === true) {
          draft.tiles.push(makeTile(path[1]));
        }
      }
      return;
    }

    if (action.action === "perform-node-action") {
      switch (action.payload.id) {
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
