// SPDX-License-Identifier: MPL-2.0

// Built-in decoder for `foxglove.CompressedPointCloud` with format "draco". Converts each message
// to a `foxglove.PointCloud`, so every panel that reads point clouds shows it. Uses the Draco
// decoder that three.js ships (also used for Draco-compressed glTF models), run on the main thread
// because message converters are synchronous. The decoder is fetched only once a recording has
// such a topic: players call preloadDraco() with their topics, and the converter loads it on first
// use.

/* eslint-disable no-underscore-dangle -- Emscripten prefixes the module's exports with "_" */

import type { PackedElementField, PointCloud } from "@foxglove/schemas";

import { InstalledMessageConverter } from "@lichtblick/suite-base/types/messageConverters";
import { addFoxgloveSchema } from "@lichtblick/suite-base/util/foxgloveSchemas";
import { toError } from "@lichtblick/suite-base/util/toError";

export const COMPRESSED_POINT_CLOUD_SCHEMAS = new Set<string>();
addFoxgloveSchema(COMPRESSED_POINT_CLOUD_SCHEMAS, "foxglove.CompressedPointCloud");

/** The parts of the Emscripten Draco module this file uses. */
type DracoObject = { ptr: number };
type DracoAttribute = DracoObject & {
  attribute_type(): number;
  num_components(): number;
  data_type(): number;
  unique_id(): number;
};
type DracoDecoder = DracoObject & {
  DecodeArrayToPointCloud(data: Uint8Array, size: number, out: DracoObject): DracoStatus;
  GetAttribute(pc: DracoObject, index: number): DracoAttribute;
  GetAttributeMetadata(pc: DracoObject, attributeId: number): DracoObject;
  GetAttributeDataArrayForAllPoints(
    pc: DracoObject,
    attribute: DracoAttribute,
    dataType: number,
    byteLength: number,
    ptr: number,
  ): boolean;
};
type DracoStatus = DracoObject & { ok(): boolean; error_msg(): string };
type DracoPointCloud = DracoObject & { num_points(): number; num_attributes(): number };
type DracoMetadataQuerier = DracoObject & {
  HasEntry(metadata: DracoObject, name: string): boolean;
  GetStringEntry(metadata: DracoObject, name: string): string;
};
type DracoModule = {
  Decoder: new () => DracoDecoder;
  PointCloud: new () => DracoPointCloud;
  MetadataQuerier: new () => DracoMetadataQuerier;
  destroy(object: DracoObject): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  POSITION: number;
  NORMAL: number;
  COLOR: number;
  DT_INT8: number;
  DT_UINT8: number;
  DT_INT16: number;
  DT_UINT16: number;
  DT_INT32: number;
  DT_UINT32: number;
  DT_FLOAT32: number;
  DT_FLOAT64: number;
};
type DracoModuleFactory = (options: { wasmBinary: ArrayBuffer }) => Promise<DracoModule>;

let draco: DracoModule | undefined;
let loading: Promise<void> | undefined;

export async function loadDraco(): Promise<void> {
  loading ??= (async () => {
    // Loaded on demand: the wrapper script alone is ~60 kB
    const [{ default: wasmUrl }, { default: wrapperJs }] = await Promise.all([
      import("three/examples/jsm/libs/draco/draco_decoder.wasm"),
      import("three/examples/jsm/libs/draco/draco_wasm_wrapper.js?raw"),
    ]);
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    // The wrapper is a classic script that defines `DracoDecoderModule`: evaluate it in its own
    // scope (as DRACOLoader does in its worker) to get the factory without a global. `process` is
    // hidden so it never takes its Node.js code path (which calls `require`), e.g. in tests.
    // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- bundled code, as in DRACOLoader
    const factory = new Function("process", `${wrapperJs}\nreturn DracoDecoderModule;`)(
      undefined,
    ) as DracoModuleFactory;
    draco = await factory({ wasmBinary });
  })().catch((err: unknown) => {
    loading = undefined; // retry on the next message, e.g. after a network hiccup
    throw err;
  });
  await loading;
}

const PRELOAD_TIMEOUT_MS = 5000;

/** Loads the decoder if any topic needs it. Never rejects (the converter reports errors) and waits
 * at most PRELOAD_TIMEOUT_MS, or until `signal` aborts, so a stalled download cannot hold up
 * playback or closing. The load itself keeps going for later messages. */
export async function preloadDraco(
  topics: readonly { schemaName?: string }[],
  signal?: AbortSignal,
): Promise<void> {
  if (
    signal?.aborted === true ||
    !topics.some(
      (topic) =>
        topic.schemaName != undefined && COMPRESSED_POINT_CLOUD_SCHEMAS.has(topic.schemaName),
    )
  ) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, PRELOAD_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", done, { once: true });
    void loadDraco()
      .catch(() => {})
      .finally(done);
  });
}

// foxglove.NumericType values
const NumericType = {
  UINT8: 1,
  INT8: 2,
  UINT16: 3,
  INT16: 4,
  UINT32: 5,
  INT32: 6,
  FLOAT32: 7,
  FLOAT64: 8,
} as const;

/** Field names for an attribute's components: positions are x/y/z, colors red/green/blue/alpha. */
function componentNames(module: DracoModule, type: number, name: string, count: number): string[] {
  const named = (names: string[]) => names.slice(0, count);
  if (type === module.POSITION && count <= 3) {
    return named(["x", "y", "z"]);
  }
  if (type === module.COLOR && count <= 4) {
    return named(["red", "green", "blue", "alpha"]);
  }
  if (type === module.NORMAL && count <= 3) {
    return named(["normal_x", "normal_y", "normal_z"]);
  }
  return count === 1 ? [name] : Array.from({ length: count }, (_, i) => `${name}_${i}`);
}

export type DecodedPointCloud = Pick<PointCloud, "fields" | "point_stride" | "data">;

/** Decodes a Draco point cloud into packed little-endian fields. Requires loadDraco(). */
export function decodeDracoPointCloud(payload: Uint8Array): DecodedPointCloud {
  const module = draco;
  if (!module) {
    throw new Error("Draco decoder is not loaded");
  }
  // Draco data types, the matching foxglove.NumericType and the size in bytes
  const types = new Map<number, [numericType: number, size: number]>([
    [module.DT_INT8, [NumericType.INT8, 1]],
    [module.DT_UINT8, [NumericType.UINT8, 1]],
    [module.DT_INT16, [NumericType.INT16, 2]],
    [module.DT_UINT16, [NumericType.UINT16, 2]],
    [module.DT_INT32, [NumericType.INT32, 4]],
    [module.DT_UINT32, [NumericType.UINT32, 4]],
    [module.DT_FLOAT32, [NumericType.FLOAT32, 4]],
    [module.DT_FLOAT64, [NumericType.FLOAT64, 8]],
  ]);

  const decoder = new module.Decoder();
  const pointCloud = new module.PointCloud();
  const querier = new module.MetadataQuerier();
  try {
    const status = decoder.DecodeArrayToPointCloud(payload, payload.byteLength, pointCloud);
    if (!status.ok()) {
      throw new Error(status.error_msg());
    }
    const numPoints = pointCloud.num_points();

    // Read each attribute as its own array, then interleave them into one point buffer
    const columns: { offset: number; size: number; components: number; bytes: Uint8Array }[] = [];
    const fields: PackedElementField[] = [];
    let stride = 0;
    for (let i = 0; i < pointCloud.num_attributes(); i++) {
      const attribute = decoder.GetAttribute(pointCloud, i);
      const components = attribute.num_components();
      // Integer types Draco has but foxglove.PointCloud lacks (64-bit, bool) are read as float32
      const [numericType, size] = types.get(attribute.data_type()) ?? [NumericType.FLOAT32, 4];
      const dataType =
        numericType === NumericType.FLOAT32 ? module.DT_FLOAT32 : attribute.data_type();
      const metadata = decoder.GetAttributeMetadata(pointCloud, i);
      const name =
        metadata.ptr !== 0 && querier.HasEntry(metadata, "name")
          ? querier.GetStringEntry(metadata, "name")
          : `attribute_${attribute.unique_id()}`;
      const names = componentNames(module, attribute.attribute_type(), name, components);

      const byteLength = numPoints * components * size;
      const ptr = module._malloc(byteLength);
      try {
        if (byteLength > 0 && ptr === 0) {
          throw new Error(`Out of memory decoding ${byteLength} bytes`);
        }
        if (
          !decoder.GetAttributeDataArrayForAllPoints(
            pointCloud,
            attribute,
            dataType,
            byteLength,
            ptr,
          )
        ) {
          throw new Error(`Failed to read point attribute "${name}"`);
        }
        // HEAPU8 is read after malloc: growing the memory replaces it
        columns.push({
          offset: stride,
          size,
          components,
          bytes: module.HEAPU8.slice(ptr, ptr + byteLength),
        });
      } finally {
        module._free(ptr);
      }
      for (const [component, fieldName] of names.entries()) {
        fields.push({ name: fieldName, offset: stride + component * size, type: numericType });
      }
      stride += components * size;
    }

    const data = new Uint8Array(numPoints * stride);
    for (const { offset, size, components, bytes } of columns) {
      const elementBytes = size * components;
      for (let point = 0; point < numPoints; point++) {
        data.set(
          bytes.subarray(point * elementBytes, (point + 1) * elementBytes),
          point * stride + offset,
        );
      }
    }
    return { fields, point_stride: stride, data };
  } finally {
    module.destroy(querier);
    module.destroy(pointCloud);
    module.destroy(decoder);
  }
}

type CompressedPointCloud = Partial<Omit<PointCloud, "fields" | "point_stride" | "data">> & {
  data?: Uint8Array;
  format?: string;
};

// Each panel converts its own messages: decode a message once for all of them
const decoded = new WeakMap<CompressedPointCloud, PointCloud>();

const converter: InstalledMessageConverter["converter"] = (msg, event, _variables, context) => {
  const cloud = msg as CompressedPointCloud;
  const cached = decoded.get(cloud);
  if (cached) {
    return cached;
  }
  if (cloud.format !== "draco") {
    context?.emitAlert(
      {
        severity: "warn",
        message: `Unsupported point cloud compression "${cloud.format ?? ""}"`,
        tip: "Only Draco-compressed point clouds can be displayed.",
      },
      `draco-format-${cloud.format ?? ""}`,
    );
    return undefined;
  }
  if (!draco) {
    // File players preload the decoder; live sources load it here and drop the first message
    loadDraco().catch((err: unknown) => {
      context?.emitAlert(
        { severity: "error", message: "Failed to load the Draco decoder", error: toError(err) },
        "draco-load",
      );
    });
    return undefined;
  }
  let points: DecodedPointCloud;
  try {
    points = decodeDracoPointCloud(cloud.data ?? new Uint8Array(0));
  } catch (err) {
    context?.emitAlert(
      {
        severity: "error",
        message: `Failed to decode Draco point cloud on ${event.topic}`,
        error: toError(err),
      },
      `draco-decode-${event.topic}`,
    );
    return undefined;
  }
  const result: PointCloud = {
    timestamp: cloud.timestamp ?? { sec: 0, nsec: 0 },
    frame_id: cloud.frame_id ?? "",
    pose: cloud.pose ?? {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    ...points,
  };
  decoded.set(cloud, result);
  return result;
};

/** One converter per encoding variation of the schema name (foxglove., foxglove_msgs/, ...). */
export const dracoMessageConverters: readonly InstalledMessageConverter[] = [
  ...COMPRESSED_POINT_CLOUD_SCHEMAS,
].map((fromSchemaName) => ({
  fromSchemaName,
  toSchemaName: "foxglove.PointCloud",
  supportsLatestPerRenderTick: true,
  converter,
}));
