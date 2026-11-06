// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { CompressedImage } from "@foxglove/schemas";
import { deflateSync } from "node:zlib";

import { decodeCompressedDepth, decodeRvl, isCompressedDepthFormat } from "./decodeCompressedDepth";

/** 16-bit grayscale PNG, using filter type `row % 5` for each row so every filter is exercised. */
function makePng(width: number, height: number, samples: number[]): Uint8Array {
  const rowBytes = width * 2;
  const pixels = new Uint8Array(rowBytes * height);
  samples.forEach((value, i) => {
    pixels[i * 2] = value >> 8;
    pixels[i * 2 + 1] = value & 0xff;
  });
  const filtered: number[] = [];
  for (let row = 0; row < height; row++) {
    const filter = row % 5;
    filtered.push(filter);
    for (let i = 0; i < rowBytes; i++) {
      const at = (r: number, c: number) => (r >= 0 && c >= 0 ? pixels[r * rowBytes + c]! : 0);
      const [left, up, upLeft] = [at(row, i - 2), at(row - 1, i), at(row - 1, i - 2)];
      const p = left + up - upLeft;
      const paeth =
        Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft)
          ? left
          : Math.abs(p - up) <= Math.abs(p - upLeft)
            ? up
            : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter]!;
      filtered.push((at(row, i) - predictor) & 0xff);
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    return [...out]; // CRC left as zero, the decoder does not check it
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([16, 0, 0, 0, 0], 8);
  const compressed = deflateSync(new Uint8Array(filtered));
  // Split the image data over two IDAT chunks
  const half = Math.floor(compressed.length / 2);
  return new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", compressed.subarray(0, half)),
    ...chunk("IDAT", compressed.subarray(half)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

/** Port of RvlCodec::CompressRVL from compressed_depth_image_transport. */
function encodeRvl(input: number[]): Uint8Array {
  const words: number[] = [];
  let word = 0;
  let nibbles = 0;
  const writeVle = (toWrite: number) => {
    let value = toWrite;
    do {
      let nibble = value & 7;
      value >>>= 3;
      if (value !== 0) {
        nibble |= 8;
      }
      word = ((word << 4) | nibble) >>> 0;
      if (++nibbles === 8) {
        words.push(word);
        word = 0;
        nibbles = 0;
      }
    } while (value !== 0);
  };
  let previous = 0;
  for (let i = 0; i < input.length; ) {
    let zeros = 0;
    while (i < input.length && input[i] === 0) {
      zeros++;
      i++;
    }
    writeVle(zeros);
    const start = i;
    while (i < input.length && input[i] !== 0) {
      i++;
    }
    writeVle(i - start);
    for (let j = start; j < i; j++) {
      const delta = input[j]! - previous;
      writeVle((delta << 1) ^ (delta >> 31));
      previous = input[j]!;
    }
  }
  if (nibbles !== 0) {
    words.push((word << (4 * (8 - nibbles))) >>> 0);
  }
  const out = new Uint8Array(words.length * 4);
  words.forEach((w, i) => {
    new DataView(out.buffer).setUint32(i * 4, w, true);
  });
  return out;
}

function makeImage(format: string, payload: Uint8Array, quantA = 0, quantB = 0): CompressedImage {
  const data = new Uint8Array(12 + payload.length);
  const view = new DataView(data.buffer);
  view.setFloat32(4, quantA, true);
  view.setFloat32(8, quantB, true);
  data.set(payload, 12);
  return { timestamp: { sec: 1, nsec: 2 }, frame_id: "camera", format, data };
}

// 3x5 so every PNG filter type gets one row; includes values above 255 and 0
const SAMPLES = [0, 1, 1000, 65535, 300, 2, 40000, 0, 7, 256, 512, 1023, 9, 8, 60000];

describe("isCompressedDepthFormat", () => {
  it.each([
    ["16UC1; compressedDepth png", true],
    ["32FC1; compressedDepth rvl", true],
    ["16UC1; compressedDepth", true],
    ["png", false],
    ["rgb8; jpeg compressed bgr8", false],
  ])("%s -> %s", (format, expected) => {
    expect(isCompressedDepthFormat(format)).toBe(expected);
  });
});

describe("decodeCompressedDepth", () => {
  it.each(["16UC1; compressedDepth png", "16UC1; compressedDepth"])(
    "decodes 16-bit PNG depth (%s)",
    async (format) => {
      const result = await decodeCompressedDepth(makeImage(format, makePng(3, 5, SAMPLES)));
      expect(result).toMatchObject({
        encoding: "16UC1",
        width: 3,
        height: 5,
        step: 6,
        frame_id: "camera",
        timestamp: { sec: 1, nsec: 2 },
      });
      expect(Array.from(new Uint16Array(result.data.buffer as ArrayBuffer))).toEqual(SAMPLES);
    },
  );

  it("undoes inverse depth quantization for 32FC1", async () => {
    const [quantA, quantB] = [1000, -10];
    const result = await decodeCompressedDepth(
      makeImage("32FC1; compressedDepth png", makePng(2, 1, [0, 490]), quantA, quantB),
    );
    expect(result.encoding).toBe("32FC1");
    const meters = new Float32Array(result.data.buffer as ArrayBuffer);
    expect(meters[0]).toBeNaN();
    expect(meters[1]).toBeCloseTo(2);
  });

  it("decodes RVL depth", async () => {
    const size = new Uint8Array(8);
    new DataView(size.buffer).setUint32(0, 3, true);
    new DataView(size.buffer).setUint32(4, 5, true);
    const result = await decodeCompressedDepth(
      makeImage("16UC1; compressedDepth rvl", new Uint8Array([...size, ...encodeRvl(SAMPLES)])),
    );
    expect(result).toMatchObject({ encoding: "16UC1", width: 3, height: 5 });
    expect(Array.from(new Uint16Array(result.data.buffer as ArrayBuffer))).toEqual(SAMPLES);
  });

  it("rejects unsupported codecs, encodings and payloads", async () => {
    const png = makePng(1, 1, [5]);
    await expect(
      decodeCompressedDepth(makeImage("16UC1; compressedDepth jpeg", png)),
    ).rejects.toThrow('Unsupported compressedDepth codec "jpeg"');
    await expect(
      decodeCompressedDepth(makeImage("8UC1; compressedDepth png", png)),
    ).rejects.toThrow('Unsupported compressedDepth encoding "8UC1"');
    await expect(
      decodeCompressedDepth(makeImage("16UC1; compressedDepth png", new Uint8Array(40))),
    ).rejects.toThrow("not a PNG image");
    await expect(
      decodeCompressedDepth(makeImage("16UC1; compressedDepth rvl", new Uint8Array(4))),
    ).rejects.toThrow("missing its size header");
    const hugeSize = new Uint8Array(8);
    new DataView(hugeSize.buffer).setUint32(0, 100_000, true);
    new DataView(hugeSize.buffer).setUint32(4, 100_000, true);
    await expect(
      decodeCompressedDepth(makeImage("16UC1; compressedDepth rvl", hugeSize)),
    ).rejects.toThrow("invalid size 100000x100000");
    await expect(
      decodeCompressedDepth(makeImage("16UC1; compressedDepth png", makePng(0, 1, []))),
    ).rejects.toThrow("invalid size 0x1");
  });
});

describe("decodeRvl", () => {
  it("round-trips runs of zeros and large deltas", () => {
    const input = [0, 0, 0, 65535, 1, 1, 0, 30000, 30001, 0, 0];
    expect(Array.from(decodeRvl(encodeRvl(input), input.length))).toEqual(input);
  });

  it("throws on truncated data instead of looping", () => {
    expect(() => decodeRvl(new Uint8Array(0), 4)).toThrow("truncated");
    expect(() => decodeRvl(new Uint8Array(4), 4)).toThrow("corrupt");
  });
});
