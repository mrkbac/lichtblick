// SPDX-License-Identifier: MPL-2.0

// Built-in decoder for Cloudini point clouds (point_cloud_interfaces/msg/CompressedPointCloud2 with
// format "cloudini"). The WASM decoder (build/build.sh) is fetched only once a recording has such a
// topic: players call preloadCloudini() with their topics, and the converter loads it on first use.

/* eslint-disable no-underscore-dangle -- Emscripten prefixes the module's exports with "_" */

import { Time } from "@foxglove/rostime";

import { InstalledMessageConverter } from "@lichtblick/suite-base/types/messageConverters";
import delay from "@lichtblick/suite-base/util/delay";

import type { CloudiniModule } from "./wasm/cloudini_decoder";
import wasmUrl from "./wasm/cloudini_decoder.wasm";

export const CLOUDINI_SCHEMA = "point_cloud_interfaces/msg/CompressedPointCloud2";

type CompressedPointCloud2 = {
  header: { stamp: Time; frame_id: string };
  height: number;
  width: number;
  fields: unknown[];
  is_bigendian: boolean;
  point_step: number;
  row_step: number;
  compressed_data: Uint8Array;
  is_dense: boolean;
  format: string;
};

type PointCloud2 = Omit<CompressedPointCloud2, "compressed_data" | "format"> & { data: Uint8Array };

let wasm: CloudiniModule | undefined;
let loading: Promise<void> | undefined;

export async function loadCloudini(): Promise<void> {
  loading ??= (async () => {
    const [{ default: createCloudiniModule }, wasmBinary] = await Promise.all([
      import("./wasm/cloudini_decoder"),
      fetch(wasmUrl).then(async (res) => await res.arrayBuffer()),
    ]);
    wasm = await createCloudiniModule({ wasmBinary });
  })().catch((err: unknown) => {
    loading = undefined; // retry on the next message, e.g. after a network hiccup
    throw err;
  });
  await loading;
}

const PRELOAD_TIMEOUT_MS = 5000;

/** Loads the decoder if any topic needs it. Never rejects (the converter reports errors) and waits
 * at most PRELOAD_TIMEOUT_MS, so a stalled download cannot hold up playback. */
export async function preloadCloudini(topics: readonly { schemaName?: string }[]): Promise<void> {
  if (topics.some((topic) => topic.schemaName === CLOUDINI_SCHEMA)) {
    await Promise.race([loadCloudini().catch(() => {}), delay(PRELOAD_TIMEOUT_MS)]);
  }
}

/** Decodes a Cloudini payload into `decodedSize` bytes of PointCloud2 data. Requires loadCloudini(). */
export function decodeCloudini(payload: Uint8Array, decodedSize: number): Uint8Array {
  if (!wasm) {
    throw new Error("Cloudini decoder is not loaded");
  }
  if (decodedSize === 0) {
    return new Uint8Array(0);
  }
  const input = wasm._malloc(payload.byteLength);
  const output = wasm._malloc(decodedSize);
  try {
    if (input === 0 || output === 0) {
      throw new Error(`Out of memory decoding ${decodedSize} bytes`);
    }
    // HEAPU8 is read after malloc: growing the memory replaces it
    wasm.HEAPU8.set(payload, input);
    const error = wasm._cldn_Decode(input, payload.byteLength, output, decodedSize);
    if (error !== 0) {
      throw new Error(wasm.UTF8ToString(error));
    }
    return wasm.HEAPU8.slice(output, output + decodedSize);
  } finally {
    wasm._free(input);
    wasm._free(output);
  }
}

// Each panel converts its own messages: decode a message once for all of them
const decoded = new WeakMap<CompressedPointCloud2, PointCloud2>();

export const cloudiniMessageConverter: InstalledMessageConverter = {
  fromSchemaName: CLOUDINI_SCHEMA,
  toSchemaName: "sensor_msgs/msg/PointCloud2",
  supportsLatestPerRenderTick: true,
  converter: (msg, event, _globalVariables, context) => {
    const cloud = msg as CompressedPointCloud2;
    const cached = decoded.get(cloud);
    if (cached) {
      return cached;
    }
    if (cloud.format !== "cloudini") {
      context?.emitAlert(
        {
          severity: "warn",
          message: `Unsupported point cloud compression "${cloud.format}"`,
          tip: "Only Cloudini-compressed point clouds can be displayed.",
        },
        `cloudini-format-${cloud.format}`,
      );
      return undefined;
    }
    if (!wasm) {
      // File players preload the decoder; live sources load it here and drop the first message
      loadCloudini().catch((err: unknown) => {
        context?.emitAlert(
          {
            severity: "error",
            message: "Failed to load the Cloudini decoder",
            error: err as Error,
          },
          "cloudini-load",
        );
      });
      return undefined;
    }
    const { compressed_data, format: _format, ...rest } = cloud;
    let data: Uint8Array;
    try {
      data = decodeCloudini(compressed_data, cloud.width * cloud.height * cloud.point_step);
    } catch (err) {
      context?.emitAlert(
        {
          severity: "error",
          message: `Failed to decode Cloudini point cloud on ${event.topic}`,
          error: err as Error,
        },
        `cloudini-decode-${event.topic}`,
      );
      return undefined;
    }
    const result: PointCloud2 = {
      ...rest,
      is_bigendian: false,
      row_step: cloud.width * cloud.point_step,
      data,
    };
    decoded.set(cloud, result);
    return result;
  },
};
