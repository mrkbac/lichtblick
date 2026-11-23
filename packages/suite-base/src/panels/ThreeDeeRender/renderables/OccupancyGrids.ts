// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import * as THREE from "three/webgpu";

import { SettingsTreeAction } from "@lichtblick/suite";
import type { RosValue } from "@lichtblick/suite-base/players/types";

import type { AnyRendererSubscription } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import type { Renderer } from "../Renderer";
import {
  PartialMessage,
  PartialMessageEvent,
  SceneExtension,
  onlyLastByTopicMessage,
} from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { SRGBToLinear, stringToRgba } from "../color";
import { sameBytes } from "../math";
import {
  normalizeHeader,
  normalizePose,
  normalizeInt8Array,
  normalizeTime,
} from "../normalizeMessages";
import { ColorRGBA, OccupancyGrid, OCCUPANCY_GRID_DATATYPES } from "../ros";
import { BaseSettings } from "../settings";
import { OCCUPANCY_GRID_DEFAULTS, occupancyGridSettingsNode } from "../settingsNodes/topics";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";

type ColorModes = "custom" | "costmap" | "map" | "raw";

export type LayerSettingsOccupancyGrid = BaseSettings & {
  frameLocked: boolean;
  minColor: string;
  maxColor: string;
  unknownColor: string;
  invalidColor: string;
  colorMode: ColorModes;
  alpha: number;
};

const INVALID_OCCUPANCY_GRID = "INVALID_OCCUPANCY_GRID";

const DEFAULT_SETTINGS = OCCUPANCY_GRID_DEFAULTS;

export type OccupancyGridUserData = BaseUserData & {
  settings: LayerSettingsOccupancyGrid;
  topic: string;
  occupancyGrid: OccupancyGrid;
  mesh: THREE.Mesh;
  texture: THREE.DataTexture;
  material: THREE.MeshBasicNodeMaterial;
  /** The texture and settings the current cells were last drawn into */
  rasterized?: { texture: THREE.DataTexture; settings: LayerSettingsOccupancyGrid };
};

export class OccupancyGridRenderable extends Renderable<OccupancyGridUserData> {
  public override dispose(): void {
    this.userData.texture.dispose();
    this.userData.material.dispose();
  }

  public override details(): Record<string, RosValue> {
    return this.userData.occupancyGrid;
  }
}

export class OccupancyGrids extends SceneExtension<OccupancyGridRenderable> {
  public static extensionId = "foxglove.OccupancyGrids";
  public constructor(renderer: Renderer, name: string = OccupancyGrids.extensionId) {
    super(name, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: OCCUPANCY_GRID_DATATYPES,
        subscription: { handler: this.#handleOccupancyGrid, filterQueue: onlyLastByTopicMessage },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (!topicIsConvertibleToSchema(topic, OCCUPANCY_GRID_DATATYPES)) {
        continue;
      }

      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsOccupancyGrid>;
      entries.push({
        path: ["topics", topic.name],
        node: { ...occupancyGridSettingsNode(topic, config), handler },
      });
    }
    return entries;
  }

  public override gpuReady(): void {
    for (const renderable of this.renderables.values()) {
      this.#updateOccupancyGridRenderable(
        renderable,
        renderable.userData.occupancyGrid,
        renderable.userData.receiveTime,
      );
    }
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    this.saveSetting(path, action.payload.value);

    // Update the renderable
    const topicName = path[1]!;
    const renderable = this.renderables.get(topicName);
    if (renderable) {
      const prevTransparent = occupancyGridHasTransparency(renderable.userData.settings);
      const settings = this.renderer.config.topics[topicName];
      renderable.userData.settings = { ...DEFAULT_SETTINGS, ...settings };

      // Check if the transparency changed and we need to create a new material
      const newTransparent = occupancyGridHasTransparency(renderable.userData.settings);
      if (prevTransparent !== newTransparent) {
        renderable.userData.material.transparent = newTransparent;
        renderable.userData.material.depthWrite = !newTransparent;
        renderable.userData.material.needsUpdate = true;
      }

      this.#updateOccupancyGridRenderable(
        renderable,
        renderable.userData.occupancyGrid,
        renderable.userData.receiveTime,
      );
    }
  };

  #handleOccupancyGrid = (messageEvent: PartialMessageEvent<OccupancyGrid>): void => {
    const topic = messageEvent.topic;
    const occupancyGrid = normalizeOccupancyGrid(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    let renderable = this.renderables.get(topic);
    if (!renderable) {
      // Set the initial settings from default values merged with any user settings
      const userSettings = this.renderer.config.topics[topic];
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };

      const texture = createTexture(occupancyGrid);
      const geometry = this.renderer.sharedGeometry.getGeometry(
        this.constructor.name,
        createGeometry,
      );
      const mesh = createMesh(topic, geometry, texture, settings);
      const material = mesh.material as THREE.MeshBasicNodeMaterial;

      // Create the renderable
      renderable = new OccupancyGridRenderable(topic, this.renderer, {
        receiveTime,
        messageTime: toNanoSec(occupancyGrid.header.stamp),
        frameId: this.renderer.normalizeFrameId(occupancyGrid.header.frame_id),
        pose: occupancyGrid.info.origin,
        settingsPath: ["topics", topic],
        settings,
        topic,
        occupancyGrid,
        mesh,
        texture,
        material,
      });
      renderable.add(mesh);

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    this.#updateOccupancyGridRenderable(renderable, occupancyGrid, receiveTime);
  };

  #updateOccupancyGridRenderable(
    renderable: OccupancyGridRenderable,
    occupancyGrid: OccupancyGrid,
    receiveTime: bigint,
  ): void {
    const previous = renderable.userData.occupancyGrid;
    renderable.userData.occupancyGrid = occupancyGrid;
    renderable.userData.pose = occupancyGrid.info.origin;
    renderable.userData.receiveTime = receiveTime;
    renderable.userData.messageTime = toNanoSec(occupancyGrid.header.stamp);
    renderable.userData.frameId = this.renderer.normalizeFrameId(occupancyGrid.header.frame_id);

    const size = occupancyGrid.info.width * occupancyGrid.info.height;
    if (occupancyGrid.data.length !== size) {
      const message = `OccupancyGrid data length (${occupancyGrid.data.length}) is not equal to width ${occupancyGrid.info.width} * height ${occupancyGrid.info.height}`;
      invalidOccupancyGridError(this.renderer, renderable, message);
      return;
    }
    this.renderer.settings.errors.removeFromTopic(
      renderable.userData.topic,
      INVALID_OCCUPANCY_GRID,
    );

    let texture = renderable.userData.texture;
    const width = occupancyGrid.info.width;
    const height = occupancyGrid.info.height;
    const resolution = occupancyGrid.info.resolution;

    renderable.userData.mesh.visible = this.renderer.checkTextureSize(
      renderable.userData.topic,
      width,
      height,
    );
    if (!renderable.userData.mesh.visible) {
      return;
    }

    if (width !== texture.image.width || height !== texture.image.height) {
      // The image dimensions changed, regenerate the texture
      texture.dispose();
      texture = createTexture(occupancyGrid);
      renderable.userData.texture = texture;
      renderable.userData.material.map = texture;
      // Picking variants are clones of this material; bump its version so they pick up the new map
      renderable.userData.material.needsUpdate = true;
    }

    // Update the occupancy grid texture, unless it shows these cells with these settings already
    const settings = renderable.userData.settings;
    if (
      texture !== renderable.userData.rasterized?.texture ||
      settings !== renderable.userData.rasterized.settings ||
      // An unchanged republished map skips its upload (normalized grids hold an Int8Array)
      !sameBytes(previous.data as Int8Array, occupancyGrid.data as Int8Array)
    ) {
      updateTexture(texture, occupancyGrid, settings);
      renderable.userData.rasterized = { texture, settings };
    }

    renderable.scale.set(resolution * width, resolution * height, 1);
  }
}
function createGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  geometry.translate(0.5, 0.5, 0);
  geometry.computeBoundingSphere();
  return geometry;
}
function invalidOccupancyGridError(
  renderer: Renderer,
  renderable: OccupancyGridRenderable,
  message: string,
): void {
  renderer.settings.errors.addToTopic(renderable.userData.topic, INVALID_OCCUPANCY_GRID, message);
}

function createTexture(occupancyGrid: OccupancyGrid): THREE.DataTexture {
  const width = occupancyGrid.info.width;
  const height = occupancyGrid.info.height;
  const size = width * height;
  const rgba = new Uint8ClampedArray(size * 4);
  const texture = new THREE.DataTexture(
    rgba,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.LinearFilter,
    1,
    THREE.LinearSRGBColorSpace, // OccupancyGrid carries linear-sRGB grayscale values, not sRGB
  );
  texture.generateMipmaps = false;
  return texture;
}

function createMesh(
  topic: string,
  geometry: THREE.PlaneGeometry,
  texture: THREE.DataTexture,
  settings: LayerSettingsOccupancyGrid,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, createMaterial(texture, topic, settings));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const tempUnknownColor = { r: 0, g: 0, b: 0, a: 0 };
const tempInvalidColor = { r: 0, g: 0, b: 0, a: 0 };
const tempMinColor = { r: 0, g: 0, b: 0, a: 0 };
const tempMaxColor = { r: 0, g: 0, b: 0, a: 0 };
// RGBA per cell value (int8, indexed as uint8). Clamped like the texture, so stored bytes match
const lut = new Uint8ClampedArray(256 * 4);
const lut32 = new Uint32Array(lut.buffer);

function setLut(value: number, r: number, g: number, b: number, a: number): void {
  const offset = (value & 0xff) * 4;
  lut[offset + 0] = r;
  lut[offset + 1] = g;
  lut[offset + 2] = b;
  lut[offset + 3] = a;
}

function updateLut(settings: LayerSettingsOccupancyGrid): void {
  if (settings.colorMode === "custom") {
    stringToRgba(tempMinColor, settings.minColor);
    stringToRgba(tempMaxColor, settings.maxColor);
    stringToRgba(tempUnknownColor, settings.unknownColor);
    stringToRgba(tempInvalidColor, settings.invalidColor);
    srgbToLinearUint8(tempMinColor);
    srgbToLinearUint8(tempMaxColor);
    srgbToLinearUint8(tempUnknownColor);
    srgbToLinearUint8(tempInvalidColor);
    for (let value = -128; value <= 127; value++) {
      if (value === -1) {
        // Unknown (-1)
        const c = tempUnknownColor;
        setLut(value, c.r, c.g, c.b, c.a);
      } else if (value >= 0 && value <= 100) {
        // Valid [0-100]
        const frac = value / 100;
        const min = tempMinColor;
        const max = tempMaxColor;
        setLut(
          value,
          min.r + (max.r - min.r) * frac,
          min.g + (max.g - min.g) * frac,
          min.b + (max.b - min.b) * frac,
          min.a + (max.a - min.a) * frac,
        );
      } else {
        // Invalid (< -1 or > 100)
        const c = tempInvalidColor;
        setLut(value, c.r, c.g, c.b, c.a);
      }
    }
    return;
  }
  // Palettes are indexed by the cell value as uint8; unknown modes fall back to raw (the settings show an error)
  const palette: [number, number, number, number][] =
    settings.colorMode === "costmap"
      ? (costmapPalette ??= createCostmapPalette())
      : settings.colorMode === "map"
        ? (mapPalette ??= createMapPalette())
        : (rawPalette ??= createRawPalette());
  for (let value = 0; value < 256; value++) {
    const [r, g, b, a] = palette[value]!;
    setLut(value, r, g, b, a * settings.alpha);
  }
}

function updateTexture(
  texture: THREE.DataTexture,
  occupancyGrid: OccupancyGrid,
  settings: LayerSettingsOccupancyGrid,
): void {
  // A cell is one of 256 values: color those once, then copy one 32-bit texel per cell
  updateLut(settings);
  const size = occupancyGrid.info.width * occupancyGrid.info.height;
  const rgba = texture.image.data as Uint8ClampedArray;
  const texels = new Uint32Array(rgba.buffer, rgba.byteOffset, size);
  const data = occupancyGrid.data;
  for (let i = 0; i < size; i++) {
    texels[i] = lut32[data[i]! & 0xff]!;
  }

  texture.needsUpdate = true;
}

function createMaterial(
  texture: THREE.DataTexture,
  topic: string,
  settings: LayerSettingsOccupancyGrid,
): THREE.MeshBasicNodeMaterial {
  const transparent = occupancyGridHasTransparency(settings);
  // The alpha test also discards empty cells in the picking pass, which derives from this material
  return new THREE.MeshBasicNodeMaterial({
    name: `${topic}:Material`,
    // Enable alpha clipping. Fully transparent (alpha=0) pixels are skipped
    // even when transparency is disabled
    alphaTest: 1e-4,
    depthWrite: !transparent,
    map: texture,
    side: THREE.DoubleSide,
    transparent,
  });
}

function occupancyGridHasTransparency(settings: LayerSettingsOccupancyGrid): boolean {
  if (settings.colorMode === "custom") {
    stringToRgba(tempMinColor, settings.minColor);
    stringToRgba(tempMaxColor, settings.maxColor);
    stringToRgba(tempUnknownColor, settings.unknownColor);
    stringToRgba(tempInvalidColor, settings.invalidColor);
    return (
      tempMinColor.a < 1 || tempMaxColor.a < 1 || tempInvalidColor.a < 1 || tempUnknownColor.a < 1
    );
  } else {
    return true;
  }
}

function srgbToLinearUint8(color: ColorRGBA): void {
  color.r = Math.trunc(SRGBToLinear(color.r) * 255);
  color.g = Math.trunc(SRGBToLinear(color.g) * 255);
  color.b = Math.trunc(SRGBToLinear(color.b) * 255);
  color.a = Math.trunc(color.a * 255);
}

function normalizeOccupancyGrid(message: PartialMessage<OccupancyGrid>): OccupancyGrid {
  const info = message.info ?? {};

  return {
    header: normalizeHeader(message.header),
    info: {
      map_load_time: normalizeTime(info.map_load_time),
      resolution: info.resolution ?? 0,
      width: info.width ?? 0,
      height: info.height ?? 0,
      origin: normalizePose(info.origin),
    },
    data: normalizeInt8Array(message.data),
  };
}

let costmapPalette: [number, number, number, number][] | undefined;
let mapPalette: [number, number, number, number][] | undefined;
let rawPalette: [number, number, number, number][] | undefined;

// Based off of rviz map implementation
// https://github.com/ros-visualization/rviz/blob/1f622b8c95b8e188841b5505db2f97394d3e9c6c/src/rviz/default_plugin/map_display.cpp#L284
function createMapPalette() {
  let index = 0;
  const palette = new Array(256).fill([0, 0, 0, 0]);

  // Standard gray map palette values
  for (let i = 0; i <= 100; i++) {
    const v = Math.trunc(255 - (255 * i) / 100);
    palette[index++] = [v, v, v, 255];
  }

  // illegal positive values in green
  for (let i = 101; i <= 127; i++) {
    palette[index++] = [0, 255, 0, 255];
  }

  // illegal negative (char) values in shades of red/yellow
  for (let i = 128; i <= 254; i++) {
    palette[index++] = [255, Math.trunc((255 * (i - 128)) / (254 - 128)), 0, 255];
  }

  // legal -1 value is tasteful blueish greenish grayish color
  palette[index++] = [112, 137, 134, 255];
  return palette;
}

// Based off of rviz costmap implementation
// https://github.com/ros-visualization/rviz/blob/1f622b8c95b8e188841b5505db2f97394d3e9c6c/src/rviz/default_plugin/map_display.cpp#L322
function createCostmapPalette() {
  let index = 0;
  const palette = new Array(256).fill([0, 0, 0, 0]);
  // zero values have alpha=0
  palette[index++] = [0, 0, 0, 0];

  // Blue to red spectrum for most normal cost values
  for (let i = 1; i <= 98; i++) {
    const v = Math.trunc((255 * i) / 100);
    palette[index++] = [v, 0, 255 - v, 255];
  }
  // inscribed obstacle values (99) in cyan
  palette[index++] = [0, 255, 255, 255];

  // lethal obstacle values (100) in purple
  palette[index++] = [255, 0, 255, 255];

  // illegal positive values in green
  for (let i = 101; i <= 127; i++) {
    palette[index++] = [0, 255, 0, 255];
  }

  // illegal negative (char) values in shades of red/yellow
  for (let i = 128; i <= 254; i++) {
    palette[index++] = [255, Math.trunc((255 * (i - 128)) / (254 - 128)), 0, 255];
  }

  // legal -1 value is tasteful blueish greenish grayish color
  palette[index++] = [112, 137, 134, 255];
  return palette;
}

// Based off of rviz raw implementation
// https://github.com/ros-visualization/rviz/blob/1f622b8c95b8e188841b5505db2f97394d3e9c6c/src/rviz/default_plugin/map_display.cpp#L377
function createRawPalette() {
  let index = 0;
  const palette = new Array(256).fill([0, 0, 0, 0]);

  // Standard gray map palette values
  for (let i = 0; i < 256; i++) {
    palette[index++] = [i, i, i, 255];
  }

  return palette;
}
