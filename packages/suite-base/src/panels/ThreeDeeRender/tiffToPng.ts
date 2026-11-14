// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import UTIF from "utif";

/** True if `data` starts with a little-endian ("II*\0") or big-endian ("MM\0*") TIFF header. */
export function isTiff(data: Uint8Array): boolean {
  const [a, b, c, d] = data;
  return (
    (a === 0x49 && b === 0x49 && c === 42 && d === 0) ||
    (a === 0x4d && b === 0x4d && c === 0 && d === 42)
  );
}

/**
 * Browsers can't decode TIFF in <img>, which three.js uses for textures, so re-encode the first
 * image of a TIFF as PNG.
 */
// ponytail: decodes on the main thread; one-off per texture, move to a worker if large TIFFs stutter.
export async function tiffToPng(data: Uint8Array): Promise<Blob> {
  assertTiffStructure(data);
  const buffer = data.slice().buffer;
  const [ifd] = UTIF.decode(buffer);
  if (!ifd) {
    throw new Error("TIFF contains no image");
  }
  UTIF.decodeImage(buffer, ifd);
  const { width, height } = ifd;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas unavailable for TIFF conversion");
  }
  context.putImageData(
    new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(ifd)), width, height),
    0,
    0,
  );
  return await canvas.convertToBlob({ type: "image/png" });
}

// Bytes per element for each TIFF field type (1-13, plus 16-18 from BigTIFF).
const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
  16: 8,
  17: 8,
  18: 8,
};

/**
 * UTIF trusts the directory chain and each entry's declared element count, so a malformed file
 * could loop forever or iterate billions of times and hang the renderer. Walk the top-level
 * directories first and reject loops, unknown field types and payloads that run past the file.
 */
function assertTiffStructure(data: Uint8Array): void {
  const malformed = () => new Error("Malformed TIFF directory");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const littleEndian = data[0] === 0x49;
  const seen = new Set<number>();
  let offset = data.byteLength >= 8 ? view.getUint32(4, littleEndian) : -1;
  while (offset !== 0) {
    if (offset < 0 || offset + 2 > data.byteLength || seen.has(offset)) {
      throw malformed();
    }
    seen.add(offset);
    const entries = view.getUint16(offset, littleEndian);
    const nextOffsetAt = offset + 2 + entries * 12;
    if (nextOffsetAt + 4 > data.byteLength) {
      throw malformed();
    }
    for (let entry = offset + 2; entry < nextOffsetAt; entry += 12) {
      const size = TYPE_SIZES[view.getUint16(entry + 2, littleEndian)];
      if (size == undefined) {
        throw malformed();
      }
      const length = size * view.getUint32(entry + 4, littleEndian);
      if (length > 4 && view.getUint32(entry + 8, littleEndian) + length > data.byteLength) {
        throw malformed();
      }
    }
    offset = view.getUint32(nextOffsetAt, littleEndian);
  }
}
