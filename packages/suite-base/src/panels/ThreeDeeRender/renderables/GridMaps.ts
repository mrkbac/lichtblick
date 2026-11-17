// SPDX-License-Identifier: MPL-2.0

// Renders grid_map_msgs/GridMap: one layer picks the color, an optional layer lifts the cells
// into a surface. Colors go through a lookup table on the CPU; the elevation is uploaded as a
// float texture and the vertex shader displaces and shades the surface.

import { toNanoSec } from "@foxglove/rostime";
import * as THREE from "three";

import { SettingsTreeAction } from "@lichtblick/suite";
import type { RosValue } from "@lichtblick/suite-base/players/types";

import { colorHasTransparency, getColorConverter } from "./colorMode";
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
import { normalizeFloat32Array, normalizeHeader, normalizePose } from "../normalizeMessages";
import { ColorRGBA, Float32MultiArray, GRID_MAP_DATATYPES, GridMap } from "../ros";
import { BaseSettings } from "../settings";
import type { ColorModeSettings } from "../settingsNodes/colorMode";
import {
  GRID_MAP_DEFAULTS,
  gridMapSettingsNode,
  resolveGridMapLayers,
} from "../settingsNodes/topics";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";

export type LayerSettingsGridMap = BaseSettings &
  ColorModeSettings & {
    colorMode: "colormap" | "gradient";
    frameLocked: boolean;
    colorLayer: string | undefined;
    /** "" means none was picked; undefined picks a layer named `elevation` when there is one */
    elevationLayer: string | undefined;
    interpolation: "linear" | "nearest";
    lighting: boolean;
    drawBehind: boolean;
  };

const INVALID_GRID_MAP = "INVALID_GRID_MAP";
const LUT_SIZE = 1024;

// ---- Decoding ----

export type GridMapSize = { sizeX: number; sizeY: number };

/** Cells along x (matrix rows) and y (matrix columns). */
export function gridMapSize(gridMap: GridMap): GridMapSize {
  const { resolution, length_x, length_y } = gridMap.info;
  if (!(resolution > 0)) {
    return { sizeX: 0, sizeY: 0 };
  }
  return { sizeX: Math.round(length_x / resolution), sizeY: Math.round(length_y / resolution) };
}

/**
 * Unwraps one layer into `out` (sizeX * sizeY), indexed `ty * sizeX + tx` with x and y growing
 * along the map's +x and +y axes. Layers are Eigen matrices (row index along -x, column index
 * along -y, both from the map's max corner) stored in a circular buffer that starts at
 * (`outer_start_index`, `inner_start_index`). Returns an error message for a malformed layer.
 */
export function decodeGridMapLayer(
  array: Float32MultiArray,
  { sizeX, sizeY }: GridMapSize,
  startX: number,
  startY: number,
  out: Float32Array,
): string | undefined {
  const dims = array.layout.dim;
  // Default storage is column-major: dim[0] walks columns, dim[1] rows (stride = rows)
  const rowMajor = dims[0]?.label === "row_index";
  const innerSize = rowMajor ? sizeY : sizeX;
  const stride = dims[1]?.stride ?? 0;
  const innerStride = stride > 0 ? stride : innerSize;
  const offset = array.layout.data_offset;
  const { data } = array;
  const outerSize = rowMajor ? sizeX : sizeY;
  if (data.length < offset + (outerSize - 1) * innerStride + innerSize) {
    return `layer has ${data.length} values, expected ${sizeX * sizeY} for ${sizeX}x${sizeY} cells`;
  }
  for (let ty = 0; ty < sizeY; ty++) {
    const bj = (sizeY - 1 - ty + startY) % sizeY;
    for (let tx = 0; tx < sizeX; tx++) {
      const bi = (sizeX - 1 - tx + startX) % sizeX;
      out[ty * sizeX + tx] = rowMajor
        ? data[offset + bi * innerStride + bj]!
        : data[offset + bj * innerStride + bi]!;
    }
  }
  return undefined;
}

// ---- Rendering ----

type GridMapMaterial = THREE.ShaderMaterial & {
  uniforms: {
    map: THREE.IUniform<THREE.DataTexture>;
    cells: THREE.IUniform<THREE.DataTexture>;
    cellResolution: THREE.IUniform<number>;
    useElevation: THREE.IUniform<boolean>;
    lighting: THREE.IUniform<boolean>;
    objectId: THREE.IUniform<number[]>;
  };
};

export type GridMapUserData = BaseUserData & {
  settings: LayerSettingsGridMap;
  topic: string;
  gridMap: GridMap;
  mesh: THREE.Mesh<THREE.PlaneGeometry, GridMapMaterial>;
  pickingMaterial: GridMapMaterial;
};

export class GridMapRenderable extends Renderable<GridMapUserData> {
  public override dispose(): void {
    const { mesh, pickingMaterial } = this.userData;
    mesh.geometry.dispose();
    mesh.material.uniforms.map.value.dispose();
    mesh.material.uniforms.cells.value.dispose();
    mesh.material.dispose();
    pickingMaterial.dispose();
  }

  public override details(): Record<string, RosValue> {
    // The layer data can be millions of values; the inspector only needs the metadata
    const { data: _data, ...rest } = this.userData.gridMap;
    return rest;
  }
}

export class GridMaps extends SceneExtension<GridMapRenderable> {
  public static extensionId = "foxglove.GridMaps";
  #layersByTopic = new Map<string, string[]>();

  public constructor(renderer: Renderer, name: string = GridMaps.extensionId) {
    super(name, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: GRID_MAP_DATATYPES,
        subscription: { handler: this.#handleGridMap, filterQueue: onlyLastByTopicMessage },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (!topicIsConvertibleToSchema(topic, GRID_MAP_DATATYPES)) {
        continue;
      }
      const config = (this.renderer.config.topics[topic.name] ??
        {}) as Partial<LayerSettingsGridMap>;
      const layers = this.#layersByTopic.get(topic.name) ?? [];
      entries.push({
        path: ["topics", topic.name],
        node: { ...gridMapSettingsNode(topic, config, layers), handler: this.handleSettingsAction },
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

    const topic = path[1]!;
    const renderable = this.renderables.get(topic);
    if (renderable) {
      renderable.userData.settings = this.#settings(topic);
      this.#update(renderable);
    }
  };

  #settings(topic: string): LayerSettingsGridMap {
    return {
      ...GRID_MAP_DEFAULTS,
      ...this.renderer.config.topics[topic],
    };
  }

  #handleGridMap = (messageEvent: PartialMessageEvent<GridMap>): void => {
    const { topic } = messageEvent;
    const gridMap = normalizeGridMap(messageEvent.message);
    const header = gridMap.header!;

    if (this.#layersByTopic.get(topic)?.join("\n") !== gridMap.layers.join("\n")) {
      this.#layersByTopic.set(topic, gridMap.layers);
      this.updateSettingsTree();
    }

    let renderable = this.renderables.get(topic);
    if (!renderable) {
      const material = createMaterial(topic);
      const pickingMaterial = material.clone();
      pickingMaterial.defines = { PICKING: 1 };
      pickingMaterial.uniforms = material.uniforms;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
      mesh.userData.pickingMaterial = pickingMaterial;
      renderable = new GridMapRenderable(topic, this.renderer, {
        receiveTime: 0n,
        messageTime: 0n,
        frameId: "",
        pose: gridMap.info.pose,
        settingsPath: ["topics", topic],
        settings: this.#settings(topic),
        topic,
        gridMap,
        mesh,
        pickingMaterial,
      });
      renderable.add(mesh);
      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    renderable.userData.gridMap = gridMap;
    renderable.userData.receiveTime = toNanoSec(messageEvent.receiveTime);
    renderable.userData.messageTime = toNanoSec(header.stamp);
    renderable.userData.frameId = this.renderer.normalizeFrameId(header.frame_id);
    renderable.userData.pose = gridMap.info.pose;
    this.#update(renderable);
  };

  #update(renderable: GridMapRenderable): void {
    const { gridMap, settings, topic, mesh } = renderable.userData;
    const size = gridMapSize(gridMap);
    const { sizeX, sizeY } = size;
    const error = (message: string) => {
      this.renderer.settings.errors.addToTopic(topic, INVALID_GRID_MAP, message);
      renderable.visible = false;
    };
    if (sizeX <= 0 || sizeY <= 0) {
      error(
        `Grid map has no cells (resolution ${gridMap.info.resolution}, length ${gridMap.info.length_x} x ${gridMap.info.length_y})`,
      );
      return;
    }

    const { colorLayer, elevationLayer } = resolveGridMapLayers(settings, gridMap.layers);
    const decode = (layer: string | undefined): Float32Array | string | undefined => {
      if (layer == undefined) {
        return undefined;
      }
      const index = gridMap.layers.indexOf(layer);
      const array = gridMap.data[index];
      if (!array) {
        return `Layer "${layer}" is not in this message`;
      }
      const out = new Float32Array(sizeX * sizeY);
      const message = decodeGridMapLayer(
        array,
        size,
        gridMap.outer_start_index,
        gridMap.inner_start_index,
        out,
      );
      return message != undefined ? `Layer "${layer}": ${message}` : out;
    };
    const colors = decode(colorLayer);
    const heights = decode(elevationLayer);
    if (typeof colors === "string" || typeof heights === "string") {
      error(typeof colors === "string" ? colors : (heights as string));
      return;
    }
    if (!colors) {
      error("Grid map has no layers");
      return;
    }
    this.renderer.settings.errors.removeFromTopic(topic, INVALID_GRID_MAP);
    renderable.visible = settings.visible;

    const { resolution } = gridMap.info;
    const material = mesh.material;
    const { uniforms } = material;
    uniforms.map.value = updateTexture(
      uniforms.map.value,
      colorTextureData(colors, sizeX, settings),
      sizeX,
      sizeY,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    uniforms.map.value.colorSpace = THREE.SRGBColorSpace;
    const filter = settings.interpolation === "nearest" ? THREE.NearestFilter : THREE.LinearFilter;
    uniforms.map.value.magFilter = uniforms.map.value.minFilter = filter;
    uniforms.cells.value = updateTexture(
      uniforms.cells.value,
      cellTextureData(colors, heights),
      sizeX,
      sizeY,
      THREE.RGFormat,
      THREE.FloatType,
    );
    uniforms.cellResolution.value = resolution;
    uniforms.useElevation.value = heights != undefined;
    uniforms.lighting.value = settings.lighting;

    const transparent = colorHasTransparency(settings);
    if (material.transparent !== transparent || material.depthTest === settings.drawBehind) {
      material.transparent = transparent;
      material.depthWrite = !transparent && !settings.drawBehind;
      material.depthTest = !settings.drawBehind;
      material.needsUpdate = true;
    }
    mesh.renderOrder = settings.drawBehind ? -Number.MAX_SAFE_INTEGER : 0;

    // A surface needs a vertex per cell center; a flat map is one quad over the whole extent
    const geometryKey = `${sizeX}x${sizeY}@${resolution}:${heights != undefined}`;
    if (mesh.userData.geometryKey !== geometryKey) {
      mesh.userData.geometryKey = geometryKey;
      mesh.geometry.dispose();
      mesh.geometry = createGeometry(size, resolution, { perCell: heights != undefined });
    }
  }
}

/** sRGB colors of `values` through a lookup table, transparent where a value is NaN. */
function colorTextureData(
  values: Float32Array,
  sizeX: number,
  settings: LayerSettingsGridMap,
): Uint8Array {
  let { minValue, maxValue } = settings;
  if (minValue == undefined || maxValue == undefined) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
    minValue ??= Number.isFinite(min) ? min : 0;
    maxValue ??= Number.isFinite(max) ? max : 1;
  }

  const convert = getColorConverter(settings, 0, LUT_SIZE - 1);
  const lut = new Uint8Array(LUT_SIZE * 4);
  const color: ColorRGBA = { r: 0, g: 0, b: 0, a: 0 };
  for (let i = 0; i < LUT_SIZE; i++) {
    convert(color, i);
    lut[i * 4 + 0] = linearToSrgbByte(color.r);
    lut[i * 4 + 1] = linearToSrgbByte(color.g);
    lut[i * 4 + 2] = linearToSrgbByte(color.b);
    lut[i * 4 + 3] = Math.round(color.a * 255);
  }

  const scale = (LUT_SIZE - 1) / Math.max(maxValue - minValue, Number.EPSILON);
  const out = new Uint8Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    let source = values[i]!;
    if (Number.isNaN(source)) {
      // Borrow a neighbor's color so linear filtering doesn't fade valid cells toward black at
      // holes; the fragment shader still cuts the hole at the cell border.
      const left = i % sizeX > 0 ? values[i - 1]! : NaN;
      const right = i % sizeX < sizeX - 1 ? values[i + 1]! : NaN;
      source = Number.isNaN(left)
        ? Number.isNaN(right)
          ? (values[i - sizeX] ?? NaN)
          : right
        : left;
      if (Number.isNaN(source)) {
        source = values[i + sizeX] ?? NaN;
      }
      if (Number.isNaN(source)) {
        continue;
      }
    }
    const index = Math.min(Math.max(Math.round((source - minValue) * scale), 0), LUT_SIZE - 1);
    out.set(lut.subarray(index * 4, index * 4 + 4), i * 4);
  }
  return out;
}

/** Per cell: height (0 when unused or NaN) and whether the cell has a color and height. */
function cellTextureData(colors: Float32Array, heights: Float32Array | undefined): Float32Array {
  const out = new Float32Array(colors.length * 2);
  for (let i = 0; i < colors.length; i++) {
    const height = heights ? heights[i]! : 0;
    const valid = !Number.isNaN(colors[i]!) && !Number.isNaN(height);
    out[i * 2] = Number.isNaN(height) ? 0 : height;
    out[i * 2 + 1] = valid ? 1 : 0;
  }
  return out;
}

function linearToSrgbByte(c: number): number {
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(srgb, 0), 1) * 255);
}

function updateTexture(
  texture: THREE.DataTexture,
  data: Uint8Array | Float32Array,
  width: number,
  height: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
): THREE.DataTexture {
  if (texture.image.width === width && texture.image.height === height) {
    texture.image.data = data;
    texture.needsUpdate = true;
    return texture;
  }
  texture.dispose();
  const next = new THREE.DataTexture(data, width, height, format, type);
  next.generateMipmaps = false;
  next.needsUpdate = true;
  return next;
}

/**
 * A plane centered on the map pose. With elevation it has one vertex per cell center and uvs on
 * texel centers, so the vertex shader reads exactly its cell; otherwise it is one quad.
 */
function createGeometry(
  { sizeX, sizeY }: GridMapSize,
  resolution: number,
  { perCell }: { perCell: boolean },
): THREE.PlaneGeometry {
  if (!perCell) {
    return new THREE.PlaneGeometry(sizeX * resolution, sizeY * resolution);
  }
  const geometry = new THREE.PlaneGeometry(
    (sizeX - 1) * resolution,
    (sizeY - 1) * resolution,
    sizeX - 1,
    sizeY - 1,
  );
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * (sizeX - 1) + 0.5) / sizeX, (uv.getY(i) * (sizeY - 1) + 0.5) / sizeY);
  }
  return geometry;
}

function emptyTexture(format: THREE.PixelFormat, type: THREE.TextureDataType): THREE.DataTexture {
  return new THREE.DataTexture(
    type === THREE.FloatType ? new Float32Array(2) : new Uint8Array(4),
    1,
    1,
    format,
    type,
  );
}

function createMaterial(topic: string): GridMapMaterial {
  return new THREE.ShaderMaterial({
    name: `${topic}:Material`,
    side: THREE.DoubleSide,
    uniforms: {
      map: { value: emptyTexture(THREE.RGBAFormat, THREE.UnsignedByteType) },
      cells: { value: emptyTexture(THREE.RGFormat, THREE.FloatType) },
      cellResolution: { value: 1 },
      useElevation: { value: false },
      lighting: { value: true },
      objectId: { value: [NaN, NaN, NaN, NaN] },
    },
    defines: { PICKING: 0 },
    vertexShader: /* glsl */ `
      uniform sampler2D cells;
      uniform float cellResolution;
      uniform bool useElevation;
      uniform bool lighting;
      varying vec2 vUv;
      varying float vShade;

      // (height, valid) of cell c, clamped to the map edge
      vec2 cellAt(ivec2 c) {
        return texelFetch(cells, clamp(c, ivec2(0), textureSize(cells, 0) - 1), 0).rg;
      }

      void main() {
        vUv = uv;
        vec3 pos = position;
        vec3 normal = vec3(0.0, 0.0, 1.0);
        if (useElevation) {
          ivec2 c = ivec2(floor(uv * vec2(textureSize(cells, 0))));
          vec2 l = cellAt(c - ivec2(1, 0));
          vec2 r = cellAt(c + ivec2(1, 0));
          vec2 d = cellAt(c - ivec2(0, 1));
          vec2 u = cellAt(c + ivec2(0, 1));
          vec2 self = cellAt(c);
          // A hole has no height: take the mean of its valid neighbors, so the valid half of
          // each adjacent triangle stays level instead of dropping to zero
          float count = l.g + r.g + d.g + u.g;
          float mean = count > 0.0 ? (l.r * l.g + r.r * r.g + d.r * d.g + u.r * u.g) / count : 0.0;
          float h = self.g > 0.5 ? self.r : mean;
          float left = l.g > 0.5 ? l.r : h;
          float right = r.g > 0.5 ? r.r : h;
          float down = d.g > 0.5 ? d.r : h;
          float up = u.g > 0.5 ? u.r : h;
          pos.z = h;
          normal = normalize(vec3(
            (left - right) / (2.0 * cellResolution),
            (down - up) / (2.0 * cellResolution),
            1.0
          ));
        }
        vShade = 1.0;
        if (lighting) {
          // Light from above and slightly to the side; a level surface keeps its true color
          const vec3 lightDir = normalize(vec3(-0.4, -0.3, 1.0));
          vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
          vShade = clamp(0.35 + 0.65 * dot(worldNormal, lightDir) / lightDir.z, 0.35, 1.15);
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D cells;
      uniform vec4 objectId;
      varying vec2 vUv;
      varying float vShade;

      void main() {
        ivec2 size = textureSize(cells, 0);
        ivec2 c = clamp(ivec2(floor(vUv * vec2(size))), ivec2(0), size - 1);
        if (texelFetch(cells, c, 0).g < 0.5) {
          discard;
        }
        vec4 color = texture2D(map, vUv);
        if (color.a <= 0.0) {
          discard;
        }
        #if PICKING == 1
          gl_FragColor = objectId;
        #else
          gl_FragColor = vec4(color.rgb * vShade, color.a);
          #include <colorspace_fragment>
        #endif
      }
    `,
  }) as GridMapMaterial;
}

function normalizeFloat32MultiArray(
  array: PartialMessage<Float32MultiArray> | undefined,
): Float32MultiArray {
  return {
    layout: {
      dim: (array?.layout?.dim ?? []).map((dim) => ({
        label: dim?.label ?? "",
        size: dim?.size ?? 0,
        stride: dim?.stride ?? 0,
      })),
      data_offset: array?.layout?.data_offset ?? 0,
    },
    data: normalizeFloat32Array(array?.data),
  };
}

function normalizeGridMap(message: PartialMessage<GridMap>): GridMap {
  const info = message.info ?? {};
  return {
    // ROS 2 has the header on the message, ROS 1 inside `info`
    header: normalizeHeader(message.header ?? info.header),
    info: {
      resolution: info.resolution ?? 0,
      length_x: info.length_x ?? 0,
      length_y: info.length_y ?? 0,
      pose: normalizePose(info.pose),
    },
    layers: (message.layers ?? []).map((layer) => layer ?? ""),
    basic_layers: (message.basic_layers ?? []).map((layer) => layer ?? ""),
    data: (message.data ?? []).map(normalizeFloat32MultiArray),
    outer_start_index: message.outer_start_index ?? 0,
    inner_start_index: message.inner_start_index ?? 0,
  };
}
