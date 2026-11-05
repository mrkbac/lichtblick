// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RawImage } from "@foxglove/schemas";

import { CompressedImageTypes, getFrameIdFromImage, getTimestampFromImage } from "./ImageTypes";

/**
 * `compressed_depth_image_transport` publishes depth images as `sensor_msgs/CompressedImage` with
 * a format like `"16UC1; compressedDepth png"` or `"32FC1; compressedDepth rvl"`. The payload is a
 * 12 byte ConfigHeader (int32 format, float32 depthQuantA, float32 depthQuantB) followed by either
 * a 16-bit grayscale PNG or an RVL stream. Browsers can't decode these (and createImageBitmap drops
 * 16-bit PNGs to 8 bits), so we unpack them back into the raw image and let the raw decoder apply
 * the panel's color mode and value range.
 *
 * https://github.com/ros-perception/image_transport_plugins/blob/rolling/compressed_depth_image_transport/src/codec.cpp
 */
const CONFIG_HEADER_SIZE = 12;

export function isCompressedDepthFormat(format: string): boolean {
  return /;\s*compresseddepth\b/i.test(format);
}

export async function decodeCompressedDepth(image: CompressedImageTypes): Promise<RawImage> {
  const [encoding = "", transport = ""] = image.format.split(";").map((s) => s.trim());
  const codec = transport.split(/\s+/)[1]?.toLowerCase() ?? "png"; // older publishers omit it
  const { data } = image;
  if (data.byteLength <= CONFIG_HEADER_SIZE) {
    throw new Error("compressedDepth image is missing its payload");
  }
  const header = new DataView(data.buffer, data.byteOffset, CONFIG_HEADER_SIZE);
  const depthQuantA = header.getFloat32(4, true);
  const depthQuantB = header.getFloat32(8, true);
  const payload = data.subarray(CONFIG_HEADER_SIZE);

  let depth: { width: number; height: number; data: Uint16Array };
  if (codec === "png") {
    depth = await decodeGray16Png(payload);
  } else if (codec === "rvl") {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const width = view.getUint32(0, true);
    const height = view.getUint32(4, true);
    depth = { width, height, data: decodeRvl(payload.subarray(8), width * height) };
  } else {
    throw new Error(`Unsupported compressedDepth codec "${codec}", expected png or rvl`);
  }

  const { width, height } = depth;
  const base = {
    timestamp: getTimestampFromImage(image),
    frame_id: getFrameIdFromImage(image),
    width,
    height,
  };
  switch (encoding) {
    case "16UC1":
    case "mono16":
      // Depth stored directly (millimeters)
      return {
        ...base,
        encoding: "16UC1",
        step: width * 2,
        data: new Uint8Array(depth.data.buffer, depth.data.byteOffset, depth.data.byteLength),
      };
    case "32FC1": {
      // Publisher quantized inverse depth; undo it to get meters. 0 means no measurement.
      const meters = new Float32Array(depth.data.length);
      for (let i = 0; i < meters.length; i++) {
        const value = depth.data[i]!;
        meters[i] = value === 0 ? NaN : depthQuantA / (value - depthQuantB);
      }
      return { ...base, encoding: "32FC1", step: width * 4, data: new Uint8Array(meters.buffer) };
    }
    default:
      throw new Error(
        `Unsupported compressedDepth encoding "${encoding}", expected 16UC1 or 32FC1`,
      );
  }
}

/**
 * Minimal decoder for the PNGs compressed_depth_image_transport writes: non-interlaced 16-bit
 * grayscale. Returns samples in native (little-endian) order.
 */
async function decodeGray16Png(png: Uint8Array): Promise<{
  width: number;
  height: number;
  data: Uint16Array;
}> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(12) !== 0x49484452) {
    throw new Error("compressedDepth payload is not a PNG image");
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = png[24]!;
  const colorType = png[25]!;
  const interlace = png[28]!;
  if (bitDepth !== 16 || colorType !== 0 || interlace !== 0) {
    throw new Error(
      `Unsupported compressedDepth PNG (bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace}), expected 16-bit grayscale`,
    );
  }

  // Image data may be split over several IDAT chunks that together form one zlib stream
  const idat: Uint8Array[] = [];
  for (let offset = 33; offset + 8 <= png.length; ) {
    const length = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    if (type === 0x49444154 /* IDAT */) {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === 0x49454e44 /* IEND */) {
      break;
    }
    offset += 12 + length;
  }
  const stream = new Blob(idat as BlobPart[])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const rowBytes = width * 2;
  if (raw.length < (rowBytes + 1) * height) {
    throw new Error("compressedDepth PNG image data is truncated");
  }
  // Undo PNG row filters in place into `out`; bpp is 2 for 16-bit grayscale
  const out = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (rowBytes + 1)]!;
    const src = row * (rowBytes + 1) + 1;
    const dst = row * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= 2 ? out[dst + i - 2]! : 0;
      const up = row > 0 ? out[dst + i - rowBytes]! : 0;
      const upLeft = row > 0 && i >= 2 ? out[dst + i - rowBytes - 2]! : 0;
      let predictor: number;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default:
          throw new Error(`Invalid PNG row filter ${filter}`);
      }
      out[dst + i] = (raw[src + i]! + predictor) & 0xff;
    }
  }

  // PNG samples are big-endian
  const data = new Uint16Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = (out[i * 2]! << 8) | out[i * 2 + 1]!;
  }
  return { width, height, data };
}

/**
 * RVL (Wilson, "Fast Lossless Depth Image Compression", 2017) as implemented by
 * compressed_depth_image_transport: alternating runs of zeros and of zigzag-encoded deltas, all
 * written as variable-length 3-bit nibbles packed into little-endian 32-bit words.
 */
export function decodeRvl(input: Uint8Array, pixelCount: number): Uint16Array {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let wordOffset = 0;
  let word = 0;
  let nibblesLeft = 0;
  const readVle = (): number => {
    let value = 0;
    let shift = 0;
    let nibble: number;
    do {
      if (nibblesLeft === 0) {
        if (wordOffset + 4 > input.byteLength) {
          throw new Error("compressedDepth RVL data is truncated");
        }
        word = view.getUint32(wordOffset, true);
        wordOffset += 4;
        nibblesLeft = 8;
      }
      nibble = word >>> 28;
      word = (word << 4) >>> 0;
      nibblesLeft--;
      value |= (nibble & 7) << shift;
      shift += 3;
    } while ((nibble & 8) !== 0);
    return value;
  };

  const output = new Uint16Array(pixelCount);
  let i = 0;
  let previous = 0;
  while (i < pixelCount) {
    const zeros = readVle(); // zeros are already in the output
    const nonZeros = readVle();
    i += zeros;
    if ((zeros === 0 && nonZeros === 0) || i + nonZeros > pixelCount) {
      throw new Error("compressedDepth RVL data is corrupt");
    }
    const end = i + nonZeros;
    for (; i < end; i++) {
      const positive = readVle();
      previous = (previous + ((positive >>> 1) ^ -(positive & 1))) & 0xffff;
      output[i] = previous;
    }
  }
  return output;
}
