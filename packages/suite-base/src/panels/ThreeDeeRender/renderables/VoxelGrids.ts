// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toNanoSec } from "@foxglove/rostime";
import { PackedElementField, VoxelGrid } from "@foxglove/schemas";
import * as THREE from "three";

import { SettingsTreeAction } from "@lichtblick/suite";
import type { RosValue } from "@lichtblick/suite-base/players/types";

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
import { SettingsTreeEntry } from "../SettingsManager";
import { SRGBToLinear, makeRgba, rgbaToLinear, stringToRgba } from "../color";
import { VOXEL_GRID_DATATYPES as PACKED_VOXEL_GRID_DATATYPES } from "../foxglove";
import {
  normalizeByteArray,
  normalizeHeader,
  normalizePose,
  normalizeTime,
  normalizeVector3,
} from "../normalizeMessages";
import {
  ColorRGBA,
  Header,
  Vector3,
  VOXEL_GRID_DATATYPES as BIT_VOXEL_GRID_DATATYPES,
} from "../ros";
import { bestColorByField, NEEDS_MIN_MAX } from "../settingsNodes/colorMode";
import {
  bitVoxelGridSettingsNode,
  LayerSettingsVoxelGrid,
  packedVoxelGridSettingsNode,
  VOXEL_GRID_DEFAULTS,
} from "../settingsNodes/voxelGrids";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { FieldReader, getReader } from "./pointClouds/fieldReaders";

/**
 * Bit-packed voxel grid (costmap voxel layer). Each (x, y) column is one uint32: bit `z` is the
 * "marked" bit and bit `z + 16` the "present" bit of level `z`, so there are at most 16 levels.
 */
export type BitVoxelGrid = {
  header: Header;
  data: ArrayLike<number>;
  origin: Vector3;
  resolutions: Vector3;
  size_x: number;
  size_y: number;
  size_z: number;
};

const INVALID_VOXEL_GRID = "INVALID_VOXEL_GRID";
const MAX_BIT_LEVELS = 16;

/** Decoded voxels: cell centers in the grid frame, linear RGBA bytes, and source cell indices. */
export class VoxelBuffer {
  public positions = new Float32Array(0);
  public colors = new Uint8Array(0);
  public cells = new Uint32Array(0);
  public count = 0;
  public transparent = false;

  public reset(): void {
    this.count = 0;
    this.transparent = false;
  }

  public push(x: number, y: number, z: number, color: ColorRGBA, cell: number): void {
    const i = this.count;
    if (i === this.cells.length) {
      this.#grow();
    }
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    const a = (color.a * 255 + 0.5) | 0;
    this.colors[i * 4] = (color.r * 255 + 0.5) | 0;
    this.colors[i * 4 + 1] = (color.g * 255 + 0.5) | 0;
    this.colors[i * 4 + 2] = (color.b * 255 + 0.5) | 0;
    this.colors[i * 4 + 3] = a;
    if (a < 255) {
      this.transparent = true;
    }
    this.cells[i] = cell;
    this.count = i + 1;
  }

  #grow(): void {
    const capacity = Math.max(1024, this.cells.length * 2);
    const positions = new Float32Array(capacity * 3);
    positions.set(this.positions);
    const colors = new Uint8Array(capacity * 4);
    colors.set(this.colors);
    const cells = new Uint32Array(capacity);
    cells.set(this.cells);
    this.positions = positions;
    this.colors = colors;
    this.cells = cells;
  }
}

function linearColor(css: string): ColorRGBA | undefined {
  const color = stringToRgba(makeRgba(), css);
  return color.a > 0 ? rgbaToLinear(color, color) : undefined;
}

/** Color of each (level, bits) pair, `bits` = marked | present << 1; undefined = not drawn. */
function bitColorTable(
  settings: LayerSettingsVoxelGrid,
  levels: number,
): (ColorRGBA | undefined)[] {
  const table: (ColorRGBA | undefined)[] = new Array(levels * 4).fill(undefined);
  if (settings.bitColorMode === "type") {
    const marked = linearColor(settings.markedColor);
    const present = linearColor(settings.presentColor);
    const both = linearColor(settings.markedPresentColor);
    for (let z = 0; z < levels; z++) {
      table[z * 4 + 1] = marked;
      table[z * 4 + 2] = present;
      table[z * 4 + 3] = both;
    }
    return table;
  }
  // Height modes color the marked-and-present voxels by level
  const converter = getColorConverter(
    {
      ...settings,
      colorMode: settings.bitColorMode === "gradient" ? "gradient" : "colormap",
      colorMap: "rainbow",
      explicitAlpha: 1,
    },
    0,
    Math.max(levels - 1, 1),
  );
  for (let z = 0; z < levels; z++) {
    const color = makeRgba();
    converter(color, z);
    table[z * 4 + 3] = color.a > 0 ? color : undefined;
  }
  return table;
}

/** Decodes the drawn voxels of a bit-packed grid into `out`. Returns an error message, if any. */
export function decodeBitVoxelGrid(
  grid: BitVoxelGrid,
  settings: LayerSettingsVoxelGrid,
  out: VoxelBuffer,
): string | undefined {
  out.reset();
  const { size_x: sizeX, size_y: sizeY, data, resolutions: res } = grid;
  const columns = sizeX * sizeY;
  if (data.length !== columns) {
    return `Voxel grid data length (${data.length}) is not size_x ${sizeX} * size_y ${sizeY}`;
  }
  const levels = Math.min(grid.size_z, MAX_BIT_LEVELS);
  const table = bitColorTable(settings, levels);
  for (let i = 0; i < columns; i++) {
    const column = data[i]!;
    if (column === 0) {
      continue;
    }
    const x = i % sizeX;
    const y = (i - x) / sizeX;
    for (let z = 0; z < levels; z++) {
      const bits = ((column >>> z) & 1) | (((column >>> (z + 16)) & 1) << 1);
      const color = bits === 0 ? undefined : table[z * 4 + bits];
      if (color) {
        out.push(
          (x + 0.5) * res.x,
          (y + 0.5) * res.y,
          (z + 0.5) * res.z,
          color,
          (z * sizeY + y) * sizeX + x,
        );
      }
    }
  }
  return undefined;
}

function numericTypeWidth(type: number): number {
  // NumericType: 1 UINT8, 2 INT8, 3 UINT16, 4 INT16, 5 UINT32, 6 INT32, 7 FLOAT32, 8 FLOAT64
  return [0, 1, 1, 2, 2, 4, 4, 4, 8][type] ?? 0;
}

function validatePackedVoxelGrid(grid: VoxelGrid): string | undefined {
  const { cell_stride, row_stride, slice_stride, column_count: cols, row_count: rows } = grid;
  if (grid.fields.length === 0) {
    return "Voxel grid has no fields";
  }
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 0 || rows < 0) {
    return `Voxel grid column_count (${cols}) and row_count (${rows}) must be whole numbers`;
  }
  if (cell_stride * cols > row_stride) {
    return `Voxel grid row_stride (${row_stride}) is less than column_count ${cols} * cell_stride ${cell_stride}`;
  }
  if (row_stride * rows > slice_stride) {
    return `Voxel grid slice_stride (${slice_stride}) is less than row_count ${rows} * row_stride ${row_stride}`;
  }
  for (const field of grid.fields) {
    const width = numericTypeWidth(field.type);
    if (width === 0 || field.offset + width > cell_stride) {
      return `Voxel grid field "${field.name}" (type ${field.type}, offset ${field.offset}) does not fit in cell_stride ${cell_stride}`;
    }
  }
  return undefined;
}

function fieldReader(grid: VoxelGrid, name: string | undefined): FieldReader | undefined {
  const field = grid.fields.find((f) => f.name === name);
  return field ? getReader(field, grid.cell_stride, isRgbaField(field.name)) : undefined;
}

function isRgbaField(name: string): boolean {
  return name === "red" || name === "green" || name === "blue" || name === "alpha";
}

const tempColor = makeRgba();

/**
 * Decodes the drawn voxels of a grid with packed per-cell fields into `out`. A cell is empty, and
 * not drawn, when its color value is 0 or NaN (or its alpha is 0 when colored by RGBA fields).
 * Returns an error message, if any.
 */
export function decodePackedVoxelGrid(
  grid: VoxelGrid,
  settings: LayerSettingsVoxelGrid,
  out: VoxelBuffer,
): string | undefined {
  out.reset();
  const error = validatePackedVoxelGrid(grid);
  if (error) {
    return error;
  }
  const { cell_stride, row_stride, slice_stride, column_count: cols, row_count: rows } = grid;
  const { x: sizeX, y: sizeY, z: sizeZ } = grid.cell_size;
  const slices = slice_stride > 0 ? Math.floor(grid.data.byteLength / slice_stride) : 0;
  const view = new DataView(grid.data.buffer, grid.data.byteOffset, grid.data.byteLength);

  if (settings.colorMode === "rgba-fields") {
    const red = fieldReader(grid, "red");
    const green = fieldReader(grid, "green");
    const blue = fieldReader(grid, "blue");
    const alpha = fieldReader(grid, "alpha");
    if (!red || !green || !blue || !alpha) {
      return "Voxel grid needs red, green, blue and alpha fields to color by RGBA";
    }
    for (let z = 0; z < slices; z++) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const offset = z * slice_stride + y * row_stride + x * cell_stride;
          const a = alpha(view, offset);
          if (!(a > 0)) {
            continue;
          }
          tempColor.r = SRGBToLinear(red(view, offset));
          tempColor.g = SRGBToLinear(green(view, offset));
          tempColor.b = SRGBToLinear(blue(view, offset));
          tempColor.a = Math.min(a, 1);
          out.push(
            (x + 0.5) * sizeX,
            (y + 0.5) * sizeY,
            (z + 0.5) * sizeZ,
            tempColor,
            (z * rows + y) * cols + x,
          );
        }
      }
    }
    return undefined;
  }

  const colorField =
    settings.colorField ??
    bestColorByField(
      grid.fields.map((f) => f.name),
      { supportsPackedRgbModes: false },
    );
  const value = fieldReader(grid, colorField);
  if (!value) {
    return `Voxel grid has no readable field "${colorField ?? ""}" to color by`;
  }

  let minValue = settings.minValue;
  let maxValue = settings.maxValue;
  if (
    NEEDS_MIN_MAX.includes(settings.colorMode) &&
    (minValue == undefined || maxValue == undefined)
  ) {
    // Auto range over the occupied cells
    let min = Infinity;
    let max = -Infinity;
    for (let z = 0; z < slices; z++) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = value(view, z * slice_stride + y * row_stride + x * cell_stride);
          if (v !== 0 && !Number.isNaN(v)) {
            min = Math.min(min, v);
            max = Math.max(max, v);
          }
        }
      }
    }
    minValue ??= min === Infinity ? 0 : min;
    maxValue ??= max === -Infinity ? 1 : max;
  }
  const converter = getColorConverter(
    { ...settings, colorMode: settings.colorMode },
    minValue ?? 0,
    maxValue ?? 1,
  );

  for (let z = 0; z < slices; z++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = value(view, z * slice_stride + y * row_stride + x * cell_stride);
        if (v === 0 || Number.isNaN(v)) {
          continue;
        }
        converter(tempColor, v);
        if (tempColor.a > 0) {
          out.push(
            (x + 0.5) * sizeX,
            (y + 0.5) * sizeY,
            (z + 0.5) * sizeZ,
            tempColor,
            (z * rows + y) * cols + x,
          );
        }
      }
    }
  }
  return undefined;
}

type VoxelGridMessage =
  | { kind: "bit"; message: BitVoxelGrid }
  | { kind: "packed"; message: VoxelGrid };

export type VoxelGridUserData = BaseUserData & {
  settings: LayerSettingsVoxelGrid;
  topic: string;
  grid: VoxelGridMessage;
};

const UNIT_CUBE = new THREE.BoxGeometry(1, 1, 1);

/** Clears the depth buffer after drawing, so later objects draw over the voxels. */
const clearDepthAfterRender: THREE.Object3D["onAfterRender"] = (renderer) => {
  renderer.clearDepth();
};
const noop: THREE.Object3D["onAfterRender"] = () => {};

export class VoxelGridRenderable extends Renderable<VoxelGridUserData> {
  public override pickableInstances = true;
  public readonly voxels = new VoxelBuffer();
  #cellSize = { value: new THREE.Vector3(1, 1, 1) };
  #mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.MeshLambertMaterial | THREE.MeshBasicMaterial
  >;
  #pickingMaterial: THREE.ShaderMaterial;
  #instancePickingMaterial: THREE.ShaderMaterial;

  public constructor(name: string, renderer: Renderer, userData: VoxelGridUserData) {
    super(name, renderer, userData);
    const pickingMaterials = createPickingMaterials(this.#cellSize);
    this.#pickingMaterial = pickingMaterials.picking;
    this.#instancePickingMaterial = pickingMaterials.instancePicking;
    this.#mesh = new THREE.Mesh(createInstancedGeometry(), this.#createMaterial());
    // Instances are placed in the vertex shader, so three.js can't compute bounds
    this.#mesh.frustumCulled = false;
    this.#mesh.name = `${userData.topic}:VoxelGrid`;
    this.#mesh.userData = {
      pickingMaterial: this.#pickingMaterial,
      instancePickingMaterial: this.#instancePickingMaterial,
    };
    this.add(this.#mesh);
  }

  public override dispose(): void {
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#pickingMaterial.dispose();
    this.#instancePickingMaterial.dispose();
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    const { message } = this.userData.grid;
    // The raw cell data can be megabytes; the per-voxel values are in instanceDetails
    return { ...message, data: `${message.data.length} entries` };
  }

  public override instanceDetails(instanceId: number): Record<string, RosValue> | undefined {
    if (instanceId >= this.voxels.count) {
      return undefined;
    }
    const cell = this.voxels.cells[instanceId]!;
    const grid = this.userData.grid;
    if (grid.kind === "bit") {
      const { size_x: sizeX, size_y: sizeY } = grid.message;
      const x = cell % sizeX;
      const y = Math.floor(cell / sizeX) % sizeY;
      const z = Math.floor(cell / (sizeX * sizeY));
      const column = grid.message.data[y * sizeX + x] ?? 0;
      return {
        x,
        y,
        z,
        marked: ((column >>> z) & 1) === 1,
        present: ((column >>> (z + 16)) & 1) === 1,
      };
    }
    const msg = grid.message;
    const x = cell % msg.column_count;
    const y = Math.floor(cell / msg.column_count) % msg.row_count;
    const z = Math.floor(cell / (msg.column_count * msg.row_count));
    const offset = z * msg.slice_stride + y * msg.row_stride + x * msg.cell_stride;
    const view = new DataView(msg.data.buffer, msg.data.byteOffset, msg.data.byteLength);
    const details: Record<string, RosValue> = { column: x, row: y, slice: z };
    for (const field of msg.fields) {
      const reader = getReader(field, msg.cell_stride);
      if (reader) {
        details[field.name] = reader(view, offset);
      }
    }
    return details;
  }

  /** Re-decodes the current message with the current settings and uploads the voxels. */
  public update(): void {
    const { grid, settings, topic } = this.userData;
    const error =
      grid.kind === "bit"
        ? decodeBitVoxelGrid(grid.message, settings, this.voxels)
        : decodePackedVoxelGrid(grid.message, settings, this.voxels);
    const errors = this.renderer.settings.errors;
    if (error) {
      errors.addToTopic(topic, INVALID_VOXEL_GRID, error);
    } else {
      errors.removeFromTopic(topic, INVALID_VOXEL_GRID);
    }

    const size = grid.kind === "bit" ? grid.message.resolutions : grid.message.cell_size;
    this.#cellSize.value.set(size.x, size.y, size.z);
    this.#syncGeometry();
    this.#syncMaterial();
    this.#mesh.renderOrder = settings.drawBehind ? -1e6 : 0;
    this.#mesh.onAfterRender = settings.drawBehind ? clearDepthAfterRender : noop;
  }

  #syncGeometry(): void {
    const { voxels } = this;
    let geometry = this.#mesh.geometry;
    const position = geometry.getAttribute("instancePosition") as
      | THREE.InstancedBufferAttribute
      | undefined;
    if (position?.array !== voxels.positions) {
      // The buffer grew: replace the geometry so the old GPU buffers are freed
      geometry.dispose();
      geometry = createInstancedGeometry();
      geometry.setAttribute(
        "instancePosition",
        new THREE.InstancedBufferAttribute(voxels.positions, 3).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute(
        "color",
        new THREE.InstancedBufferAttribute(voxels.colors, 4, true).setUsage(THREE.DynamicDrawUsage),
      );
      this.#mesh.geometry = geometry;
    } else {
      position.needsUpdate = true;
      geometry.getAttribute("color").needsUpdate = true;
    }
    geometry.instanceCount = voxels.count;
  }

  #syncMaterial(): void {
    const { settings } = this.userData;
    const material = this.#mesh.material;
    const lit = material instanceof THREE.MeshLambertMaterial;
    if (lit !== settings.useLighting) {
      material.dispose();
      this.#mesh.material = this.#createMaterial();
    }
    const current = this.#mesh.material;
    if (current.transparent !== this.voxels.transparent) {
      current.transparent = this.voxels.transparent;
      current.needsUpdate = true;
    }
  }

  #createMaterial(): THREE.MeshLambertMaterial | THREE.MeshBasicMaterial {
    const options: THREE.MeshBasicMaterialParameters = {
      vertexColors: true,
      transparent: this.voxels.transparent,
      // Self-sorting artifacts without depth writes are worse than blending order artifacts
      depthWrite: true,
    };
    const material = this.userData.settings.useLighting
      ? new THREE.MeshLambertMaterial(options)
      : new THREE.MeshBasicMaterial(options);
    const cellSize = this.#cellSize;
    material.customProgramCacheKey = () => "voxel-grid";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.cellSize = cellSize;
      shader.vertexShader =
        "uniform vec3 cellSize;\nattribute vec3 instancePosition;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          "vec3 transformed = position * cellSize + instancePosition;",
        );
    };
    return material;
  }
}

function createInstancedGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  // Clone: disposing a geometry deletes its attributes' GL buffers
  geometry.setIndex(UNIT_CUBE.index!.clone());
  geometry.setAttribute("position", UNIT_CUBE.attributes.position!.clone());
  geometry.setAttribute("normal", UNIT_CUBE.attributes.normal!.clone());
  geometry.instanceCount = 0;
  return geometry;
}

function createPickingMaterials(cellSize: THREE.IUniform<THREE.Vector3>): {
  picking: THREE.ShaderMaterial;
  instancePicking: THREE.ShaderMaterial;
} {
  const vertexShader = (header: string) => /* glsl */ `
    uniform vec3 cellSize;
    attribute vec3 instancePosition;
    ${header}
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position * cellSize + instancePosition, 1.0);
    }
  `;
  const picking = new THREE.ShaderMaterial({
    vertexShader: vertexShader("void main() {"),
    fragmentShader: /* glsl */ `
      uniform vec4 objectId;
      void main() {
        gl_FragColor = objectId;
      }
    `,
    uniforms: { cellSize, objectId: { value: [NaN, NaN, NaN, NaN] } },
  });
  const instancePicking = new THREE.ShaderMaterial({
    vertexShader: vertexShader(/* glsl */ `
      varying vec4 objectId;
      void main() {
        objectId = vec4(
          float((gl_InstanceID >> 24) & 255) / 255.0,
          float((gl_InstanceID >> 16) & 255) / 255.0,
          float((gl_InstanceID >> 8) & 255) / 255.0,
          float(gl_InstanceID & 255) / 255.0);
    `),
    fragmentShader: /* glsl */ `
      varying vec4 objectId;
      void main() {
        gl_FragColor = objectId;
      }
    `,
    uniforms: { cellSize },
  });
  return { picking, instancePicking };
}

export class VoxelGrids extends SceneExtension<VoxelGridRenderable> {
  public static extensionId = "foxglove.VoxelGrids";
  #fieldsByTopic = new Map<string, string[]>();

  public constructor(renderer: Renderer, name: string = VoxelGrids.extensionId) {
    super(name, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: BIT_VOXEL_GRID_DATATYPES,
        subscription: { handler: this.#handleBitGrid, filterQueue: onlyLastByTopicMessage },
      },
      {
        type: "schema",
        schemaNames: PACKED_VOXEL_GRID_DATATYPES,
        subscription: { handler: this.#handlePackedGrid, filterQueue: onlyLastByTopicMessage },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsVoxelGrid>;
      let node;
      if (topicIsConvertibleToSchema(topic, PACKED_VOXEL_GRID_DATATYPES)) {
        node = packedVoxelGridSettingsNode(topic, config, this.#fieldsByTopic.get(topic.name));
      } else if (topicIsConvertibleToSchema(topic, BIT_VOXEL_GRID_DATATYPES)) {
        node = bitVoxelGridSettingsNode(topic, config);
      } else {
        continue;
      }
      entries.push({ path: ["topics", topic.name], node: { ...node, handler } });
    }
    return entries;
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }
    this.saveSetting(path, action.payload.value);
    const topic = path[1]!;
    const renderable = this.renderables.get(topic);
    if (renderable) {
      renderable.userData.settings = {
        ...VOXEL_GRID_DEFAULTS,
        ...this.renderer.config.topics[topic],
      };
      renderable.update();
    }
  };

  #handleBitGrid = (event: PartialMessageEvent<BitVoxelGrid>): void => {
    const message = normalizeBitVoxelGrid(event.message);
    this.#handleGrid(event.topic, toNanoSec(event.receiveTime), {
      kind: "bit",
      message,
    });
  };

  #handlePackedGrid = (event: PartialMessageEvent<VoxelGrid>): void => {
    const message = normalizePackedVoxelGrid(event.message);
    const topic = event.topic;
    const fields = message.fields.map((field) => field.name);
    if (this.#fieldsByTopic.get(topic)?.join() !== fields.join()) {
      this.#fieldsByTopic.set(topic, fields);
      const userSettings = (this.renderer.config.topics[topic] ??
        {}) as Partial<LayerSettingsVoxelGrid>;
      if (userSettings.colorField == undefined && fields.length > 0) {
        const auto = { ...VOXEL_GRID_DEFAULTS, ...userSettings };
        autoSelectColorSettings(auto, fields, {
          supportsPackedRgbModes: false,
          supportsRgbaFieldsMode: true,
        });
        this.renderer.updateConfig((draft) => {
          const updated: Partial<LayerSettingsVoxelGrid> = {
            ...userSettings,
            colorField: auto.colorField,
            colorMode: auto.colorMode,
            colorMap: auto.colorMap,
          };
          draft.topics[topic] = updated;
        });
        const renderable = this.renderables.get(topic);
        if (renderable) {
          renderable.userData.settings = {
            ...VOXEL_GRID_DEFAULTS,
            ...this.renderer.config.topics[topic],
          };
        }
      }
      this.updateSettingsTree();
    }
    this.#handleGrid(topic, toNanoSec(event.receiveTime), { kind: "packed", message });
  };

  #handleGrid(topic: string, receiveTime: bigint, grid: VoxelGridMessage): void {
    const { frameId, messageTime, pose } =
      grid.kind === "bit"
        ? {
            frameId: grid.message.header.frame_id,
            messageTime: toNanoSec(grid.message.header.stamp),
            pose: {
              position: grid.message.origin,
              orientation: { x: 0, y: 0, z: 0, w: 1 },
            },
          }
        : {
            frameId: grid.message.frame_id,
            messageTime: toNanoSec(grid.message.timestamp),
            pose: grid.message.pose,
          };

    let renderable = this.renderables.get(topic);
    if (!renderable) {
      renderable = new VoxelGridRenderable(topic, this.renderer, {
        receiveTime,
        messageTime,
        frameId: this.renderer.normalizeFrameId(frameId),
        pose,
        settingsPath: ["topics", topic],
        settings: { ...VOXEL_GRID_DEFAULTS, ...this.renderer.config.topics[topic] },
        topic,
        grid,
      });
      this.add(renderable);
      this.renderables.set(topic, renderable);
    }
    renderable.userData.receiveTime = receiveTime;
    renderable.userData.messageTime = messageTime;
    renderable.userData.frameId = this.renderer.normalizeFrameId(frameId);
    renderable.userData.pose = pose;
    renderable.userData.grid = grid;
    renderable.update();
  }
}

function normalizeBitVoxelGrid(message: PartialMessage<BitVoxelGrid>): BitVoxelGrid {
  return {
    header: normalizeHeader(message.header),
    data: (message.data as ArrayLike<number> | undefined) ?? [],
    origin: normalizeVector3(message.origin),
    resolutions: normalizeVector3(message.resolutions),
    size_x: message.size_x ?? 0,
    size_y: message.size_y ?? 0,
    size_z: message.size_z ?? 0,
  };
}

function normalizePackedElementField(
  field: PartialMessage<PackedElementField> | undefined,
): PackedElementField {
  return { name: field?.name ?? "", offset: field?.offset ?? 0, type: field?.type ?? 0 };
}

function normalizePackedVoxelGrid(message: PartialMessage<VoxelGrid>): VoxelGrid {
  return {
    timestamp: normalizeTime(message.timestamp),
    frame_id: message.frame_id ?? "",
    pose: normalizePose(message.pose),
    row_count: message.row_count ?? 0,
    column_count: message.column_count ?? 0,
    cell_size: normalizeVector3(message.cell_size),
    slice_stride: message.slice_stride ?? 0,
    row_stride: message.row_stride ?? 0,
    cell_stride: message.cell_stride ?? 0,
    fields: message.fields?.map(normalizePackedElementField) ?? [],
    data: normalizeByteArray(message.data),
  };
}
