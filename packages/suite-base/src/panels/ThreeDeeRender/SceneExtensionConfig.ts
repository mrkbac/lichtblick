// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Cameras } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Cameras";
import { FoxgloveGrid } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/FoxgloveGrid";
import { FrameAxes } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/FrameAxes";
import { GridMaps } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/GridMaps";
import { Grids } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Grids";
import { Images } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images";
import { LaserScans } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/LaserScans";
import { Maps } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Maps";
import { Markers } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Markers";
import { OccupancyGrids } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/OccupancyGrids";
import { PointClouds } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PointClouds";
import { Polygons } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Polygons";
import { PoseArrays } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PoseArrays";
import { Poses } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Poses";
import { PublishSettings } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/PublishSettings";
import { FoxgloveSceneEntities } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/SceneEntities";
import { SceneSettings } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/SceneSettings";
import { Urdfs } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Urdfs";
import { VelodyneScans } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/VelodyneScans";
import { VoxelGrids } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/VoxelGrids";

import type { Renderer } from "./Renderer";
import { SceneExtension } from "./SceneExtension";
import { InterfaceMode } from "./types";

/**
 * Scene extensions the Renderer creates, in order. The optional modes list restricts an extension
 * to those interface modes; without it the extension is present in both "3d" and "image".
 * ImageMode, MeasurementTool and PublishClickTool are created by the Renderer itself.
 */
export const SCENE_EXTENSIONS: readonly (readonly [
  init: (renderer: Renderer) => SceneExtension,
  modes?: readonly InterfaceMode[],
])[] = [
  [(renderer) => new PublishSettings(renderer), ["3d"]],
  [(renderer) => new Images(renderer), ["3d"]],
  [(renderer) => new Cameras(renderer), ["3d"]],
  [(renderer) => new Maps(renderer), ["3d"]],
  [(renderer) => new SceneSettings(renderer)],
  // only show frame axes and labels by default when in 3d mode
  [(renderer) => new FrameAxes(renderer, { visible: renderer.interfaceMode === "3d" })],
  [(renderer) => new Grids(renderer)],
  [(renderer) => new Markers(renderer)],
  [(renderer) => new FoxgloveSceneEntities(renderer)],
  [(renderer) => new FoxgloveGrid(renderer)],
  [(renderer) => new GridMaps(renderer)],
  [(renderer) => new LaserScans(renderer)],
  [(renderer) => new OccupancyGrids(renderer)],
  [(renderer) => new PointClouds(renderer)],
  [(renderer) => new Polygons(renderer)],
  [(renderer) => new Poses(renderer)],
  [(renderer) => new PoseArrays(renderer)],
  [(renderer) => new Urdfs(renderer)],
  [(renderer) => new VelodyneScans(renderer)],
  [(renderer) => new VoxelGrids(renderer)],
];
