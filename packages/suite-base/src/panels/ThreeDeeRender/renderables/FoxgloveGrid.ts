// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import { Grid, NumericType, PackedElementField } from "@foxglove/schemas";
import {
  Discard,
  Fn,
  If,
  abs,
  clamp,
  dot,
  faceDirection,
  float,
  floor,
  fract,
  fwidth,
  instanceIndex,
  int,
  ivec2,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  select,
  step,
  texture as textureNode,
  transformNormalToView,
  uniform,
  uv,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

import { SettingsTreeAction } from "@lichtblick/suite";
import { GRID_DATATYPES } from "@lichtblick/suite-base/panels/ThreeDeeRender/foxglove";
import {
  ColorModeSettings,
  NEEDS_MIN_MAX,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/colorMode";
import type { RosValue } from "@lichtblick/suite-base/players/types";

import { rainbowLinear, turboLinear } from "./colorMapNodes";
import { autoSelectColorSettings, getColorConverter } from "./colorMode";
import type { AnyRendererSubscription } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import type { Renderer } from "../Renderer";
import {
  PartialMessage,
  PartialMessageEvent,
  SceneExtension,
  onlyLastByTopicMessage,
} from "../SceneExtension";
import { SettingsTreeEntry, SettingsTreeNodeWithActionHandler } from "../SettingsManager";
import { rgbaToLinear, stringToRgba } from "../color";
import { normalizeByteArray, normalizePose, normalizeTime } from "../normalizeMessages";
import { BaseSettings } from "../settings";
import { FOXGLOVE_GRID_DEFAULTS, foxgloveGridSettingsNode } from "../settingsNodes/topics";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { FieldReader, getReader } from "./pointClouds/fieldReaders";

type GridColorModeSettings = ColorModeSettings & {
  // rgba packed modes are only supported for sensor_msgs/PointCloud2
  colorMode: Exclude<ColorModeSettings["colorMode"], "rgb" | "rgba">;
};

export type LayerSettingsFoxgloveGrid = BaseSettings &
  GridColorModeSettings & {
    frameLocked: boolean;
    /** Numeric field whose value lifts each cell along the grid's Z axis; undefined = flat. */
    elevationField?: string;
    interpolation: "linear" | "nearest";
    showLines: boolean;
    lineColor: string;
    /** Shade the elevated surface by its slope. */
    lighting: boolean;
    /** Render before the rest of the scene, so everything else draws on top. */
    drawBehind: boolean;
  };
function zeroReader(): number {
  return 0;
}

/**
 * Elevation written for cells without a finite value. The shaders treat anything below
 * -1e38 as "no data": the cell is not drawn and neighbouring corners ignore it.
 */
export const NO_ELEVATION = -3.4e38;

/** Writes each cell's elevation (row-major, `cols * rows`) into `out`. */
export function fillElevation(out: Float32Array, grid: Grid, reader: FieldReader): void {
  const view = new DataView(grid.data.buffer, grid.data.byteOffset, grid.data.byteLength);
  const { column_count: cols, row_stride, cell_stride } = grid;
  const rows = grid.data.byteLength / row_stride;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const value = reader(view, y * row_stride + x * cell_stride);
      out[y * cols + x] = Number.isFinite(value) ? value : NO_ELEVATION;
    }
  }
}

const floatTextureColorModes: GridColorModeSettings["colorMode"][] = ["gradient", "colormap"];

const INVALID_LICHTBLICK_GRID = "INVALID_LICHTBLICK_GRID";

/** How the fragment color is chosen; see `colorNode` in createMaterial */
const COLOR_SOURCE = { texture: 0, gradient: 1, turbo: 2, rainbow: 3 } as const;

const DEFAULT_SETTINGS = FOXGLOVE_GRID_DEFAULTS;

type GridUniforms = ReturnType<typeof createUniforms>;

export type FoxgloveGridUserData = BaseUserData & {
  settings: LayerSettingsFoxgloveGrid;
  topic: string;
  foxgloveGrid: Grid;
  mesh: THREE.Mesh;
  texture: THREE.DataTexture;
  material: THREE.MeshBasicNodeMaterial;
  uniforms: GridUniforms;
  /** Shared unit quad, used while the grid is flat. */
  planeGeometry: THREE.BufferGeometry;
  /** One instance per cell (two triangles over the unit cell), placed by the vertex shader */
  elevationGeometry: THREE.InstancedBufferGeometry;
};

type RgbaFieldReaders = {
  redReader: FieldReader;
  greenReader: FieldReader;
  blueReader: FieldReader;
  alphaReader: FieldReader;
};
const tempRgbaFieldReaders: RgbaFieldReaders = {
  redReader: zeroReader,
  greenReader: zeroReader,
  blueReader: zeroReader,
  alphaReader: zeroReader,
};

function numericTypeName(type: NumericType): string {
  // TypeScript types the enum reverse-mapping as `string`, but an out-of-range `type` from
  // external message data resolves to `undefined` at runtime, so the fallback is intentional.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return NumericType[type] ?? `${type}`;
}

function getTextureColorSpace(settings: GridColorModeSettings): THREE.ColorSpace {
  switch (settings.colorMode) {
    case "flat":
      // color is converted to linear by getColorConverter before being written to the texture
      return THREE.LinearSRGBColorSpace;
    case "gradient":
    case "colormap":
      // color value is raw numeric value
      return THREE.LinearSRGBColorSpace;
    case "rgba-fields":
      return THREE.SRGBColorSpace;
  }
}

const tempColor = { r: 0, g: 0, b: 0, a: 1 };
const tempMinMaxColor: THREE.Vector2Tuple = [0, 0];
export class FoxgloveGridRenderable extends Renderable<FoxgloveGridUserData> {
  public override dispose(): void {
    this.userData.texture.dispose();
    this.userData.uniforms.elevationMap.value.dispose();
    this.userData.material.dispose();
    this.userData.elevationGeometry.dispose();
  }

  public override details(): Record<string, RosValue> {
    return this.userData.foxgloveGrid;
  }

  #getRgbaFieldReaders(out: RgbaFieldReaders, foxgloveGrid: Grid) {
    const { cell_stride } = foxgloveGrid;
    for (const field of foxgloveGrid.fields) {
      const { name } = field;
      if (name === "red") {
        out.redReader = getReader(field, cell_stride, /*normalize*/ true) ?? zeroReader;
      } else if (name === "green") {
        out.greenReader = getReader(field, cell_stride, /*normalize*/ true) ?? zeroReader;
      } else if (name === "blue") {
        out.blueReader = getReader(field, cell_stride, /*normalize*/ true) ?? zeroReader;
      } else if (name === "alpha") {
        out.alphaReader = getReader(field, cell_stride, /*normalize*/ true) ?? zeroReader;
      }
    }
  }

  #getColorByFieldReader(
    foxgloveGrid: Grid,
    settings: LayerSettingsFoxgloveGrid,
  ): FieldReader | undefined {
    const { cell_stride } = foxgloveGrid;

    for (const field of foxgloveGrid.fields) {
      const { type, offset, name } = field;

      if (name === settings.colorField) {
        const fieldReader = getReader(field, cell_stride);
        if (!fieldReader) {
          const typeName = NumericType[type];
          const message = `Grid field "${name}" is invalid. type=${typeName}, offset=${offset}, stride=${cell_stride}`;
          invalidFoxgloveGridError(this.renderer, this.userData.topic, message);
          return undefined;
        }
        return fieldReader;
      }
    }

    return zeroReader;
  }

  public updateMaterial(settings: LayerSettingsFoxgloveGrid): void {
    const { colorMode } = settings;
    let transparent = false;
    if (colorMode === "flat") {
      stringToRgba(tempColor, settings.flatColor);
      transparent = tempColor.a < 1.0;
    } else if (colorMode === "gradient") {
      stringToRgba(tempColor, settings.gradient[0]);
      transparent = tempColor.a < 1.0;

      stringToRgba(tempColor, settings.gradient[1]);
      transparent = transparent || tempColor.a < 1.0;
    } else if (colorMode === "colormap") {
      transparent = settings.explicitAlpha < 1.0;
    }
    this.#setTransparent({ transparentColors: transparent });

    const filter = settings.interpolation === "linear" ? THREE.LinearFilter : THREE.NearestFilter;
    const { texture } = this.userData;
    if (texture.magFilter !== filter) {
      texture.magFilter = filter;
      texture.needsUpdate = true;
    }
    this.userData.uniforms.linear.value = settings.interpolation === "linear" ? 1 : 0;

    // Same approach as images drawn behind the scene: drawn first, without depth, so every
    // other object ends up on top.
    this.userData.mesh.renderOrder = settings.drawBehind ? -Number.MAX_SAFE_INTEGER : 0;
  }

  /** Applies transparency and the depth state that goes with it (and with "draw behind"). */
  #setTransparent({ transparentColors }: { transparentColors: boolean }): void {
    const { material, settings } = this.userData;
    // A background layer stays in the opaque pass: the transparent pass runs after all opaque
    // objects and would paint over them, since a background layer skips the depth test.
    const transparent = transparentColors && !settings.drawBehind;
    const depthWrite = !transparent && !settings.drawBehind;
    const depthTest = !settings.drawBehind;
    if (
      material.transparent !== transparent ||
      material.depthWrite !== depthWrite ||
      material.depthTest !== depthTest
    ) {
      material.transparent = transparent;
      material.depthWrite = depthWrite;
      material.depthTest = depthTest;
      material.needsUpdate = true;
    }
  }

  /** Switches between the flat quad and the GPU-displaced surface, and uploads elevations. */
  public updateElevation(foxgloveGrid: Grid, settings: LayerSettingsFoxgloveGrid): void {
    const { mesh, uniforms } = this.userData;
    const field = foxgloveGrid.fields.find((f) => f.name === settings.elevationField);
    const reader = field ? getReader(field, foxgloveGrid.cell_stride) : undefined;
    const cols = foxgloveGrid.column_count;
    const rows = foxgloveGrid.data.byteLength / foxgloveGrid.row_stride;
    uniforms.gridSize.value.set(cols, rows);

    if (!reader || cols * rows === 0) {
      mesh.geometry = this.userData.planeGeometry;
      mesh.frustumCulled = true;
      return;
    }

    let texture = uniforms.elevationMap.value as THREE.DataTexture;
    if (texture.image.width !== cols || texture.image.height !== rows) {
      texture.dispose();
      texture = createElevationTexture(cols, rows);
      uniforms.elevationMap.value = texture;
    }
    fillElevation(texture.image.data as unknown as Float32Array, foxgloveGrid, reader);
    texture.needsUpdate = true;

    const { elevationGeometry } = this.userData;
    elevationGeometry.instanceCount = cols * rows;
    mesh.geometry = elevationGeometry;
    // The shared bounding sphere describes the flat quad, not the displaced surface.
    mesh.frustumCulled = false;
  }

  public updateUniforms(foxgloveGrid: Grid, settings: LayerSettingsFoxgloveGrid): void {
    const { uniforms } = this.userData;
    uniforms.colorSource.value =
      settings.colorMode === "gradient"
        ? COLOR_SOURCE.gradient
        : settings.colorMode === "colormap"
          ? COLOR_SOURCE[settings.colorMap]
          : COLOR_SOURCE.texture;
    uniforms.colorMapOpacity.value = settings.explicitAlpha;

    minMaxColorValues(
      tempMinMaxColor,
      settings,
      foxgloveGrid.fields.find((field) => settings.colorField === field.name)?.type ??
        NumericType.UNKNOWN,
    );
    [uniforms.minValue.value, uniforms.maxValue.value] = tempMinMaxColor;

    setLinearRgba(uniforms.minGradientColor.value, settings.gradient[0]);
    setLinearRgba(uniforms.maxGradientColor.value, settings.gradient[1]);
    setLinearRgba(uniforms.lineColor.value, settings.lineColor);
    if (!settings.showLines) {
      uniforms.lineColor.value.w = 0;
    }
    uniforms.lighting.value = settings.lighting ? 1 : 0;
  }

  public updateTexture(foxgloveGrid: Grid, settings: LayerSettingsFoxgloveGrid): void {
    let texture = this.userData.texture;
    const fieldReader = this.#getColorByFieldReader(foxgloveGrid, settings);
    if (!fieldReader) {
      return;
    }

    const view = new DataView(
      foxgloveGrid.data.buffer,
      foxgloveGrid.data.byteOffset,
      foxgloveGrid.data.byteLength,
    );

    const { column_count: cols, row_stride, cell_stride } = foxgloveGrid;
    const rows = foxgloveGrid.data.length / row_stride;
    const sizeChanged = cols !== texture.image.width || rows !== texture.image.height;
    const floatMode = floatTextureColorModes.includes(settings.colorMode);
    const formatChanged = floatMode
      ? texture.format !== THREE.RedFormat
      : texture.format !== THREE.RGBAFormat;
    if (formatChanged || sizeChanged) {
      // The image dimensions or format changed, regenerate the texture
      texture.dispose();
      texture = createTexture(foxgloveGrid, settings);
      texture.generateMipmaps = false;
      this.userData.texture = texture;
      this.userData.uniforms.map.value = texture;
    }

    const colorSpace = getTextureColorSpace(settings);
    if (colorSpace !== texture.colorSpace) {
      texture.colorSpace = colorSpace;
      texture.needsUpdate = true;
    }

    if (floatMode) {
      // FLOAT texture handling (gradient & colorMap)
      // type of image.data is Uint8ClampedArray, but it is in fact the raw texture data even thought it's
      // meant to be used as an RGBA image data array
      const valueData = texture.image.data as unknown as Float32Array;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const offset = y * row_stride + x * cell_stride;
          const colorValue = fieldReader(view, offset);
          const i = y * cols + x;
          valueData[i] = colorValue;
        }
      }
    } else {
      // RGBA textures (flat & rgba modes)
      const rgba = texture.image.data!;
      let hasTransparency = false;
      if (settings.colorMode === "rgba-fields") {
        this.#getRgbaFieldReaders(tempRgbaFieldReaders, foxgloveGrid);
        const { redReader, greenReader, blueReader, alphaReader } = tempRgbaFieldReaders;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const offset = y * row_stride + x * cell_stride;
            const i = y * cols + x;
            const rgbaOffset = i * 4;
            const alpha = alphaReader(view, offset);
            rgba[rgbaOffset + 0] = (redReader(view, offset) * 255) | 0;
            rgba[rgbaOffset + 1] = (greenReader(view, offset) * 255) | 0;
            rgba[rgbaOffset + 2] = (blueReader(view, offset) * 255) | 0;
            rgba[rgbaOffset + 3] = (alpha * 255) | 0;

            // We cheat a little with transparency: alpha 0 will be handled by the alphaTest setting, so
            // we don't need to set material.transparent = true.
            if (alpha !== 0 && alpha !== 1) {
              hasTransparency = true;
            }
          }
        }
      } else if (settings.colorMode === "flat") {
        // flat
        const colorConverter = getColorConverter(
          settings as typeof settings & { colorMode: typeof settings.colorMode },
          0,
          1,
        );
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const offset = y * row_stride + x * cell_stride;
            const colorValue = fieldReader(view, offset);
            colorConverter(tempColor, colorValue);
            const i = y * cols + x;
            const rgbaOffset = i * 4;
            rgba[rgbaOffset + 0] = Math.floor(tempColor.r * 255);
            rgba[rgbaOffset + 1] = Math.floor(tempColor.g * 255);
            rgba[rgbaOffset + 2] = Math.floor(tempColor.b * 255);
            rgba[rgbaOffset + 3] = Math.floor(tempColor.a * 255);

            // We cheat a little with transparency: alpha 0 will be handled by the alphaTest setting, so
            // we don't need to set material.transparent = true.
            if (tempColor.a !== 0 && tempColor.a !== 1) {
              hasTransparency = true;
            }
          }
        }
      }
      this.#setTransparent({ transparentColors: hasTransparency });
    }
    texture.needsUpdate = true;
  }
}

export class FoxgloveGrid extends SceneExtension<FoxgloveGridRenderable> {
  public static extensionId = "foxglove.Grid";
  #fieldsByTopic = new Map<string, string[]>();

  public constructor(renderer: Renderer, name: string = FoxgloveGrid.extensionId) {
    super(name, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: GRID_DATATYPES,
        subscription: { handler: this.#handleFoxgloveGrid, filterQueue: onlyLastByTopicMessage },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (!topicIsConvertibleToSchema(topic, GRID_DATATYPES)) {
        continue;
      }
      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsFoxgloveGrid>;

      const node: SettingsTreeNodeWithActionHandler = {
        ...foxgloveGridSettingsNode(topic, config, this.#fieldsByTopic.get(topic.name)),
        handler,
      };

      entries.push({
        path: ["topics", topic.name],
        node,
      });
    }
    return entries;
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
      const settings = this.renderer.config.topics[topicName];
      renderable.userData.settings = { ...DEFAULT_SETTINGS, ...settings };

      renderable.updateMaterial(renderable.userData.settings);
      renderable.updateUniforms(renderable.userData.foxgloveGrid, renderable.userData.settings);
      if (
        action.payload.path[2] === "colorMode" ||
        action.payload.path[2] === "colorField" ||
        action.payload.path[2] === "flatColor"
      ) {
        // needs to recalculate texture when colorMode or colorField changes
        // technically it doesn't if it's going between gradient and colorMap, but since it's an infrequent user-action it's not a big hit
        renderable.updateTexture(renderable.userData.foxgloveGrid, renderable.userData.settings);
      }
      if (action.payload.path[2] === "elevationField") {
        renderable.updateElevation(renderable.userData.foxgloveGrid, renderable.userData.settings);
      }
    }
  };

  #handleFoxgloveGrid = (messageEvent: PartialMessageEvent<Grid>): void => {
    const topic = messageEvent.topic;
    const foxgloveGrid = normalizeFoxgloveGrid(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    let renderable = this.renderables.get(topic);

    if (!this.#validateFoxgloveGrid(foxgloveGrid, messageEvent.topic)) {
      if (renderable) {
        renderable.visible = false;
      }
      return;
    }

    let fields = this.#fieldsByTopic.get(topic);
    let fieldsUpdated = false;
    if (fields?.length !== foxgloveGrid.fields.length) {
      fields = foxgloveGrid.fields.map((field) => field.name);
      this.#fieldsByTopic.set(topic, fields);
      this.updateSettingsTree();
      fieldsUpdated = true;
    }

    if (renderable) {
      renderable.visible = true;
    } else {
      // Set the initial settings from default values merged with any user settings
      const userSettings = (this.renderer.config.topics[topic] ??
        {}) as Partial<LayerSettingsFoxgloveGrid>;
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };
      // only want to autoselect if it's in flatcolor mode (without colorfield) and previously didn't have fields
      if (settings.colorField == undefined && fieldsUpdated) {
        autoSelectColorSettings(settings, fields, {
          supportsPackedRgbModes: false,
          supportsRgbaFieldsMode: true,
        });
        // Update user settings with the newly selected color field
        this.renderer.updateConfig((draft) => {
          const updatedUserSettings = { ...userSettings };
          updatedUserSettings.colorField = settings.colorField;
          updatedUserSettings.colorMode = settings.colorMode;
          updatedUserSettings.colorMap = settings.colorMap;
          draft.topics[topic] = updatedUserSettings;
        });
        this.updateSettingsTree();
      }

      // Check color
      const texture = createTexture(foxgloveGrid, settings);
      const geometry = this.renderer.sharedGeometry.getGeometry(
        this.constructor.name,
        createGridGeometry,
      );
      const uniforms = createUniforms(texture);
      const material = createMaterial(uniforms, topic);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Create the renderable
      renderable = new FoxgloveGridRenderable(topic, this.renderer, {
        receiveTime,
        messageTime: toNanoSec(foxgloveGrid.timestamp),
        frameId: this.renderer.normalizeFrameId(foxgloveGrid.frame_id),
        pose: foxgloveGrid.pose,
        settingsPath: ["topics", topic],
        settings,
        topic,
        foxgloveGrid,
        mesh,
        texture,
        material,
        uniforms,
        planeGeometry: geometry,
        elevationGeometry: createCellGeometry(),
      });
      renderable.add(mesh);

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    this.#updateFoxgloveGridRenderable(
      renderable,
      foxgloveGrid,
      receiveTime,
      renderable.userData.settings,
    );
  };

  #validateFoxgloveGrid(foxgloveGrid: Grid, topic: string): boolean {
    const { cell_stride, row_stride, column_count: cols } = foxgloveGrid;
    const rows = foxgloveGrid.data.byteLength / row_stride;

    if (foxgloveGrid.fields.length === 0) {
      invalidFoxgloveGridError(
        this.renderer,
        topic,
        `Grid has no fields. At least one field is required for the Grid to be displayed.`,
      );
      return false;
    }

    if (Math.floor(cols) !== cols || Math.floor(rows) !== rows) {
      const message = `Grid column count (${foxgloveGrid.column_count}) or row count (${rows} = data.byteLength ${foxgloveGrid.data.byteLength} / row_stride ${row_stride}) is not an integer.`;
      invalidFoxgloveGridError(this.renderer, topic, message);
      return false;
    }

    if (cell_stride * cols > row_stride) {
      const message = `Grid row_stride (${row_stride}) does not allow for requisite column_count (${cols}) with cell stride (${cell_stride}). Minimum requisite bytes in row_stride needed: (${
        cols * cell_stride
      }) `;
      invalidFoxgloveGridError(this.renderer, topic, message);
      return false;
    }

    // Determine the minimum bytes needed per cell based on offset/size of each
    // field, so we can ensure cell_stride is >= this value
    let minBytesPerCell = 0;
    let maxField: PackedElementField | undefined;
    for (const field of foxgloveGrid.fields) {
      const byteWidth = numericTypeWidth(field.type);
      if (field.offset + byteWidth > minBytesPerCell) {
        minBytesPerCell = field.offset + byteWidth;
        maxField = field;
      }
    }
    if (minBytesPerCell > cell_stride) {
      let message = `Grid cell_stride (${cell_stride}) is less than minimum bytes per cell (${minBytesPerCell})`;
      if (maxField) {
        message += ` required by “${maxField.name}” field, type=${numericTypeName(
          maxField.type,
        )}, offset=${maxField.offset}`;
      }
      invalidFoxgloveGridError(this.renderer, topic, message);
      return false;
    }

    return true;
  }

  /** @param foxgloveGrid must be validated already */
  #updateFoxgloveGridRenderable(
    renderable: FoxgloveGridRenderable,
    foxgloveGrid: Grid,
    receiveTime: bigint,
    settings: LayerSettingsFoxgloveGrid,
  ): void {
    renderable.userData.foxgloveGrid = foxgloveGrid;
    renderable.userData.pose = foxgloveGrid.pose;
    renderable.userData.receiveTime = receiveTime;
    renderable.userData.messageTime = toNanoSec(foxgloveGrid.timestamp);
    renderable.userData.frameId = this.renderer.normalizeFrameId(foxgloveGrid.frame_id);
    const { row_stride, column_count: cols } = foxgloveGrid;
    const rows = foxgloveGrid.data.byteLength / row_stride;

    renderable.updateMaterial(settings);
    renderable.updateUniforms(foxgloveGrid, settings);
    renderable.updateTexture(foxgloveGrid, settings);
    renderable.updateElevation(foxgloveGrid, settings);

    renderable.scale.set(foxgloveGrid.cell_size.x * cols, foxgloveGrid.cell_size.y * rows, 1);
  }
}
function createGridGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  geometry.translate(0.5, 0.5, 0);
  geometry.computeBoundingSphere();
  return geometry;
}

function invalidFoxgloveGridError(renderer: Renderer, topic: string, message: string): void {
  renderer.settings.errors.addToTopic(topic, INVALID_LICHTBLICK_GRID, message);
}

function createTexture(foxgloveGrid: Grid, settings: LayerSettingsFoxgloveGrid): THREE.DataTexture {
  const { column_count: cols, row_stride } = foxgloveGrid;
  const rows = foxgloveGrid.data.byteLength / row_stride;
  const size = isFinite(cols * rows) ? cols * rows : 0;
  const isFloatType = floatTextureColorModes.includes(settings.colorMode);
  const data = isFloatType ? new Float32Array(size) : new Uint8ClampedArray(size * 4);
  const format = isFloatType ? THREE.RedFormat : THREE.RGBAFormat;
  const type = isFloatType ? THREE.FloatType : THREE.UnsignedByteType;
  const texture = new THREE.DataTexture(
    data,
    cols,
    rows,
    format,
    type,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    settings.interpolation === "linear" ? THREE.LinearFilter : THREE.NearestFilter,
    THREE.LinearFilter,
    1,
    getTextureColorSpace(settings),
  );
  texture.generateMipmaps = false;
  return texture;
}

/** Float texture of raw cell elevations, read with texelFetch (so never filtered). */
function createElevationTexture(cols: number, rows: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Float32Array(cols * rows),
    cols,
    rows,
    THREE.RedFormat,
    THREE.FloatType,
  );
  texture.generateMipmaps = false;
  return texture;
}

export function numericTypeWidth(type: NumericType): number {
  switch (type) {
    case NumericType.INT8:
    case NumericType.UINT8:
      return 1;
    case NumericType.INT16:
    case NumericType.UINT16:
      return 2;
    case NumericType.INT32:
    case NumericType.UINT32:
    case NumericType.FLOAT32:
      return 4;
    case NumericType.FLOAT64:
      return 8;
    default:
      return 0;
  }
}

/** Elevations below this are "no data" (see NO_ELEVATION) */
const NO_ELEVATION_THRESHOLD = -1e38;

/** The unit cell as two triangles, counter-clockwise seen from +Z; drawn once per grid cell */
function createCellGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.instanceCount = 0;
  return geometry;
}

function createUniforms(map: THREE.DataTexture) {
  return {
    map: textureNode(map),
    /** One of COLOR_SOURCE */
    colorSource: uniform(COLOR_SOURCE.texture, "int"),
    colorMapOpacity: uniform(1),
    minValue: uniform(0),
    maxValue: uniform(1),
    minGradientColor: uniform(new THREE.Vector4()),
    maxGradientColor: uniform(new THREE.Vector4()),
    /** Columns and rows */
    gridSize: uniform(new THREE.Vector2(1, 1)),
    elevationMap: textureNode(createElevationTexture(1, 1)),
    /** 0..1: how much the elevated surface is shaded by its slope */
    lighting: uniform(1),
    /** Linear RGBA; alpha 0 hides the cell borders */
    lineColor: uniform(new THREE.Vector4()),
    /** 1 for Linear interpolation, 0 for Nearest; only read where the shader filters itself */
    linear: uniform(1),
  };
}

/**
 * Flat: the shared unit quad, textured. Elevated: the unit cell instanced once per grid cell; each
 * vertex finds its cell from the instance index and lifts its corner to the corner's height, which
 * keeps memory flat however large the grid is.
 */
function createMaterial(u: GridUniforms, topic: string): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    name: `${topic}:Material`,
    side: THREE.DoubleSide,
  });
  const size = ivec2(u.gridSize);
  const vUv = varyingProperty("vec2", "vGridUv");
  const vNormal = varyingProperty("vec3", "vGridNormal");
  const elevated = (builder: THREE.NodeBuilder) =>
    (builder.geometry as Partial<THREE.InstancedBufferGeometry>).isInstancedBufferGeometry === true;

  const cellHeight = (cell: THREE.Node<"ivec2">) => u.elevationMap.load(cell).r;
  // A corner's height: the mean of the (up to 4) touching cells that have data
  const cornerHeight = Fn(([corner]: [THREE.Node<"ivec2">]) => {
    const sum = float(0).toVar();
    const count = float(0).toVar();
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const cell = corner.add(ivec2(dx, dy));
      const inside = cell.x
        .greaterThanEqual(0)
        .and(cell.y.greaterThanEqual(0))
        .and(cell.x.lessThan(size.x))
        .and(cell.y.lessThan(size.y));
      If(inside, () => {
        const h = cellHeight(cell);
        If(h.greaterThan(NO_ELEVATION_THRESHOLD), () => {
          sum.addAssign(h);
          count.addAssign(1);
        });
      });
    }
    return select(count.greaterThan(0), sum.div(count), 0);
  });

  material.positionNode = Fn((builder: THREE.NodeBuilder) => {
    if (!elevated(builder)) {
      vUv.assign(uv());
      vNormal.assign(vec3(0, 0, 1));
      return positionGeometry;
    }
    const cellIndex = int(instanceIndex);
    const corner = ivec2(cellIndex.mod(size.x), cellIndex.div(size.x))
      .add(ivec2(positionGeometry.xy))
      .toVar();
    const cornerUv = vec2(corner).div(u.gridSize);
    vUv.assign(cornerUv);
    // Smooth normal from central differences of the neighbouring corners. The mesh is a unit
    // square scaled to the grid's size, so slopes are per UV unit and the normal transform
    // applies that scale.
    const c = vec2(corner);
    const left = max(c.x.sub(1), 0);
    const right = min(c.x.add(1), u.gridSize.x);
    const down = max(c.y.sub(1), 0);
    const up = min(c.y.add(1), u.gridSize.y);
    const dhdu = cornerHeight(ivec2(vec2(right, c.y)))
      .sub(cornerHeight(ivec2(vec2(left, c.y))))
      .div(right.sub(left).div(u.gridSize.x));
    const dhdv = cornerHeight(ivec2(vec2(c.x, up)))
      .sub(cornerHeight(ivec2(vec2(c.x, down))))
      .div(up.sub(down).div(u.gridSize.y));
    vNormal.assign(transformNormalToView(vec3(dhdu.negate(), dhdv.negate(), 1)));
    return vec3(cornerUv, cornerHeight(corner));
  })();

  // Without float32-filterable, three reads a float texture as a single texel whatever its filter,
  // which would ignore Linear interpolation for scalar grids, so filter in the shader there
  const sampleMap = (builder: THREE.NodeBuilder): THREE.Node<"vec4"> => {
    if (builder.renderer.hasFeature("float32-filterable")) {
      return u.map.sample(vUv);
    }
    const texel = vUv.mul(u.gridSize).sub(0.5);
    const base = floor(texel);
    const frac = fract(texel);
    // Nearest takes the closest of the four texels
    const f = mix(step(0.5, frac), frac, u.linear);
    const load = (dx: number, dy: number) =>
      u.map.load(ivec2(clamp(base.add(vec2(dx, dy)), vec2(0, 0), u.gridSize.sub(1))));
    return mix(mix(load(0, 0), load(1, 0), f.x), mix(load(0, 1), load(1, 1), f.x), f.y);
  };

  material.colorNode = Fn((builder: THREE.NodeBuilder) => {
    if (elevated(builder)) {
      const cell = ivec2(min(floor(vUv.mul(u.gridSize)), u.gridSize.sub(1)));
      Discard(cellHeight(cell).lessThanEqual(NO_ELEVATION_THRESHOLD));
    }
    const color = sampleMap(builder);
    const t = clamp(color.r.sub(u.minValue).div(max(u.maxValue.sub(u.minValue), 1e-5)), 0, 1);
    // Gradient with pre-multiplied alpha, like CSS linear gradients
    const minColor = vec4(u.minGradientColor.rgb.mul(u.minGradientColor.a), u.minGradientColor.a);
    const maxColor = vec4(u.maxGradientColor.rgb.mul(u.maxGradientColor.a), u.maxGradientColor.a);
    const out = select(
      u.colorSource.equal(COLOR_SOURCE.gradient),
      mix(minColor, maxColor, t),
      select(
        u.colorSource.equal(COLOR_SOURCE.turbo),
        vec4(turboLinear(t), u.colorMapOpacity),
        select(
          u.colorSource.equal(COLOR_SOURCE.rainbow),
          vec4(rainbowLinear(t), u.colorMapOpacity),
          // rgba-fields (sRGB texture, decoded by the sampler) and flat (already linear)
          color,
        ),
      ),
    ).toVar();
    Discard(out.a.lessThan(1e-5));
    if (elevated(builder)) {
      // Light from above-right of the viewer, in view space
      const normal = normalize(vNormal).mul(faceDirection);
      const diffuse = max(dot(normal, normalize(vec3(0.4, 0.6, 1))), 0);
      out.rgb.mulAssign(mix(1, diffuse.mul(0.65).add(0.35), u.lighting));
    }
    // Anti-aliased cell borders about one pixel wide at any zoom
    const cellCoord = vUv.mul(u.gridSize);
    const distToEdge = abs(fract(cellCoord.sub(0.5)).sub(0.5)).div(max(fwidth(cellCoord), 1e-6));
    const line = min(min(distToEdge.x, distToEdge.y), 1).oneMinus();
    out.assign(mix(out, vec4(u.lineColor.rgb, 1), line.mul(u.lineColor.a)));
    return out;
  })();
  return material;
}

function setLinearRgba(out: THREE.Vector4, color: string): void {
  const rgba = rgbaToLinear(tempColor, stringToRgba(tempColor, color));
  out.set(rgba.r, rgba.g, rgba.b, rgba.a);
}

export function normalizePackedElementField(
  field: PartialMessage<PackedElementField> | undefined,
): PackedElementField {
  return {
    name: field?.name ?? "",
    offset: field?.offset ?? 0,
    type: field?.type ?? 0,
  };
}

function normalizeFoxgloveGrid(message: PartialMessage<Grid>): Grid {
  return {
    timestamp: normalizeTime(message.timestamp),
    pose: normalizePose(message.pose),
    frame_id: message.frame_id ?? "",
    row_stride: message.row_stride ?? 0,
    cell_stride: message.cell_stride ?? 0,
    column_count: message.column_count ?? 0,
    cell_size: {
      x: message.cell_size?.x ?? 1,
      y: message.cell_size?.y ?? 1,
    },
    fields: message.fields?.map(normalizePackedElementField) ?? [],
    data: normalizeByteArray(message.data),
  };
}

function minMaxColorValues(
  output: THREE.Vector2Tuple,
  settings: LayerSettingsFoxgloveGrid,
  numericType: NumericType,
): void {
  if (!NEEDS_MIN_MAX.includes(settings.colorMode)) {
    return;
  }

  const [numericMin, numericMax] = NumericTypeMinMaxValueMap[numericType];
  const minColorValue = settings.minValue ?? numericMin;
  const maxColorValue = settings.maxValue ?? numericMax;
  output[0] = minColorValue;
  output[1] = maxColorValue;
}

const NumericTypeMinMaxValueMap: Record<NumericType, [number, number]> = {
  [NumericType.UNKNOWN]: [0, 1.0],
  [NumericType.UINT8]: [0, 255],
  [NumericType.UINT16]: [0, 65535],
  [NumericType.UINT32]: [0, Math.pow(2, 32) - 1],
  [NumericType.INT8]: [-128, 127],
  [NumericType.INT16]: [-Math.pow(2, 16 - 1), -Math.pow(2, 16 - 1) - 1],
  [NumericType.INT32]: [-Math.pow(2, 32 - 1), -Math.pow(2, 32 - 1) - 1],
  [NumericType.FLOAT32]: [0, 1.0],
  [NumericType.FLOAT64]: [0, 1.0],
};
