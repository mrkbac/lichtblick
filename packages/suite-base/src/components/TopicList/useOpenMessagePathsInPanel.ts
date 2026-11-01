// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import {
  useCurrentLayoutActions,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import * as foxglove from "@lichtblick/suite-base/panels/ThreeDeeRender/foxglove";
import * as ros from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";
import {
  dropOnFirstAcceptingPanel,
  queuePanelDrop,
} from "@lichtblick/suite-base/services/messagePathDragging/panelDropRegistry";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";

const IMAGE_SCHEMAS = new Set([
  ...ros.IMAGE_DATATYPES,
  ...ros.COMPRESSED_IMAGE_DATATYPES,
  ...foxglove.RAW_IMAGE_DATATYPES,
  ...foxglove.COMPRESSED_IMAGE_DATATYPES,
  ...foxglove.COMPRESSED_VIDEO_DATATYPES,
]);

// ponytail: static list, ignores user message converters; ask the 3D renderer if that matters.
const SCENE_SCHEMAS = new Set([
  ...ros.TF_DATATYPES,
  ...ros.TRANSFORM_STAMPED_DATATYPES,
  ...ros.MARKER_DATATYPES,
  ...ros.MARKER_ARRAY_DATATYPES,
  ...ros.OCCUPANCY_GRID_DATATYPES,
  ...ros.POINTCLOUD_DATATYPES,
  ...ros.LASERSCAN_DATATYPES,
  ...ros.VELODYNE_SCAN_DATATYPES,
  ...ros.POSE_STAMPED_DATATYPES,
  ...ros.POSE_WITH_COVARIANCE_STAMPED_DATATYPES,
  ...ros.POSE_ARRAY_DATATYPES,
  ...ros.NAV_PATH_DATATYPES,
  ...ros.POLYGON_STAMPED_DATATYPES,
  ...foxglove.FRAME_TRANSFORM_DATATYPES,
  ...foxglove.FRAME_TRANSFORMS_DATATYPES,
  ...foxglove.POINTCLOUD_DATATYPES,
  ...foxglove.LASERSCAN_DATATYPES,
  ...foxglove.SCENE_UPDATE_DATATYPES,
  ...foxglove.POSE_IN_FRAME_DATATYPES,
  ...foxglove.POSES_IN_FRAME_DATATYPES,
  ...foxglove.GRID_DATATYPES,
]);

/** Picks the panel type a new panel should have to show the given message paths. */
export function getPanelTypeForPaths(paths: readonly DraggedMessagePath[]): string {
  const allTopicsOf = (schemas: ReadonlySet<string>) =>
    paths.every((p) => p.isTopic && p.rootSchemaName != undefined && schemas.has(p.rootSchemaName));

  if (paths.length === 1 && allTopicsOf(IMAGE_SCHEMAS)) {
    return "Image";
  }
  if (allTopicsOf(SCENE_SCHEMAS)) {
    return "3D";
  }
  if (paths.every((p) => p.isLeaf)) {
    return "Plot";
  }
  return "RawMessages";
}

/**
 * Shows message paths in the selected panel if it accepts them, otherwise in a new panel of the
 * matching type. The new panel gets selected so further paths are added to it.
 */
export function useOpenMessagePathsInPanel(): (paths: readonly DraggedMessagePath[]) => void {
  const { addPanel } = useCurrentLayoutActions();
  const { getSelectedPanelIds, setSelectedPanelIds } = useSelectedPanels();

  return useCallback(
    (paths: readonly DraggedMessagePath[]) => {
      if (paths.length === 0 || dropOnFirstAcceptingPanel(getSelectedPanelIds(), paths)) {
        return;
      }
      // Raw Messages only shows one path at a time
      const type = getPanelTypeForPaths(paths);
      const shownPaths = type === "RawMessages" ? paths.slice(0, 1) : paths;
      const id = getPanelIdForType(type);
      // The 3D panel only accepts image drops, so show its topics through the initial config
      if (type === "3D") {
        const topics = Object.fromEntries(shownPaths.map((p) => [p.topicName, { visible: true }]));
        addPanel({ id, config: { topics } });
        setSelectedPanelIds([id]);
        return;
      }
      addPanel({ id });
      setSelectedPanelIds([id]);
      queuePanelDrop(id, shownPaths);
    },
    [addPanel, getSelectedPanelIds, setSelectedPanelIds],
  );
}
