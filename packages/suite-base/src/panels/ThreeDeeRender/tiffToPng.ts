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
  assertIfdChainTerminates(data);
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

/**
 * UTIF follows the top-level directory chain without a cycle or bounds check, so a malformed file
 * would hang the renderer. Walk the chain first and reject loops and out-of-range offsets.
 */
function assertIfdChainTerminates(data: Uint8Array): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const littleEndian = data[0] === 0x49;
  const seen = new Set<number>();
  let offset = data.byteLength >= 8 ? view.getUint32(4, littleEndian) : -1;
  while (offset !== 0) {
    if (offset < 0 || offset + 2 > data.byteLength || seen.has(offset)) {
      throw new Error("Malformed TIFF directory chain");
    }
    seen.add(offset);
    const nextOffsetAt = offset + 2 + view.getUint16(offset, littleEndian) * 12;
    if (nextOffsetAt + 4 > data.byteLength) {
      throw new Error("Malformed TIFF directory chain");
    }
    offset = view.getUint32(nextOffsetAt, littleEndian);
  }
}
