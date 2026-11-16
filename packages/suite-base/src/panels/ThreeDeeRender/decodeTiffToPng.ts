// SPDX-License-Identifier: MPL-2.0

import UTIF from "utif";

// Kept apart from tiffToPng.ts: if the worker imported the module that starts it, the worker chunk
// and the page chunk would depend on each other ("Circular dependency between chunks with runtime").
/** Decode the first image of a TIFF and encode it as PNG. Called inside the worker. */
export async function decodeTiffToPng(data: Uint8Array): Promise<Blob> {
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
