// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Malformed TIFFs can make UTIF loop forever, so a decode that takes longer is abandoned. */
export const TIFF_DECODE_TIMEOUT_MS = 10_000;

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
 * image of a TIFF as PNG. Runs in a worker so a slow or malformed file can't block the renderer.
 */
export async function tiffToPng(data: Uint8Array): Promise<Blob> {
  const worker = new Worker(new URL("./tiffToPng.worker", import.meta.url));
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`TIFF decoding took longer than ${TIFF_DECODE_TIMEOUT_MS} ms`));
      }, TIFF_DECODE_TIMEOUT_MS);
      worker.onmessage = ({ data: result }: MessageEvent<Blob | Error>) => {
        clearTimeout(timeout);
        if (result instanceof Blob) {
          resolve(result);
        } else {
          reject(result);
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error(`TIFF decoding failed: ${event.message}`));
      };
      worker.postMessage(data);
    });
  } finally {
    worker.terminate();
  }
}
