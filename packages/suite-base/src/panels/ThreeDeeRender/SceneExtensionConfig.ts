// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Cameras } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Cameras";
import { FoxgloveGrid } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/FoxgloveGrid";
import { FrameAxes } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/FrameAxes";
import { Grids } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Grids";
import { ImageMode } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/ImageMode";
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

import type { Renderer } from "./Renderer";
import { SceneExtension } from "./SceneExtension";
import { MeasurementTool } from "./renderables/MeasurementTool";
import { PublishClickTool } from "./renderables/PublishClickTool";
import { InterfaceMode } from "./types";

export type SceneExtensionConfig = {
  /** Reserved because the Renderer has members that reference them specifically */
  reserved: ReservedSceneExtensionConfig;
  extensionsById: Record<string, ExtensionOverride<SceneExtension>>;
};

export type ReservedSceneExtensionConfig = {
  imageMode: ExtensionOverride<ImageMode>;
  measurementTool: ExtensionOverride<MeasurementTool>;
  publishClickTool: ExtensionOverride<PublishClickTool>;
};

export type ExtensionOverride<ExtensionType extends SceneExtension> = {
  init: (renderer: Renderer) => ExtensionType;
  /** Which interfaceModes this extension is supported in. If undefined, will default be present in BOTH '3d' and 'image' modes */
  supportedInterfaceModes?: InterfaceMode[];
};

export const DEFAULT_SCENE_EXTENSION_CONFIG: SceneExtensionConfig = {
  reserved: {
    imageMode: {
      init: (renderer: Renderer) => new ImageMode(renderer),
    },
    measurementTool: {
      init: (renderer: Renderer) => new MeasurementTool(renderer),
    },
    publishClickTool: {
      init: (renderer: Renderer) => new PublishClickTool(renderer),
    },
  },
  extensionsById: {
    [PublishSettings.extensionId]: {
      init: (renderer: Renderer) => new PublishSettings(renderer),
      supportedInterfaceModes: ["3d"],
    },
    [Images.extensionId]: {
      init: (renderer: Renderer) => new Images(renderer),
      supportedInterfaceModes: ["3d"],
    },
    [Cameras.extensionId]: {
      init: (renderer: Renderer) => new Cameras(renderer),
      supportedInterfaceModes: ["3d"],
    },
    [Maps.extensionId]: {
      init: (renderer: Renderer) => new Maps(renderer),
      supportedInterfaceModes: ["3d"],
    },
    [SceneSettings.extensionId]: {
      init: (renderer: Renderer) => new SceneSettings(renderer),
    },
    [FrameAxes.extensionId]: {
      init: (renderer: Renderer) =>
        // only show frame axes and labels by default when in 3d mode
        new FrameAxes(renderer, { visible: renderer.interfaceMode === "3d" }),
    },
    [Grids.extensionId]: {
      init: (renderer: Renderer) => new Grids(renderer),
    },
    [Markers.extensionId]: {
      init: (renderer: Renderer) => new Markers(renderer),
    },
    [FoxgloveSceneEntities.extensionId]: {
      init: (renderer: Renderer) => new FoxgloveSceneEntities(renderer),
    },
    [FoxgloveGrid.extensionId]: {
      init: (renderer: Renderer) => new FoxgloveGrid(renderer),
    },
    [LaserScans.extensionId]: {
      init: (renderer: Renderer) => new LaserScans(renderer),
    },
    [OccupancyGrids.extensionId]: {
      init: (renderer: Renderer) => new OccupancyGrids(renderer),
    },
    [PointClouds.extensionId]: {
      init: (renderer: Renderer) => new PointClouds(renderer),
    },
    [Polygons.extensionId]: {
      init: (renderer: Renderer) => new Polygons(renderer),
    },
    [Poses.extensionId]: {
      init: (renderer: Renderer) => new Poses(renderer),
    },
    [PoseArrays.extensionId]: {
      init: (renderer: Renderer) => new PoseArrays(renderer),
    },
    [Urdfs.extensionId]: {
      init: (renderer: Renderer) => new Urdfs(renderer),
    },
    [VelodyneScans.extensionId]: {
      init: (renderer: Renderer) => new VelodyneScans(renderer),
    },
  },
};
