// SPDX-License-Identifier: MPL-2.0

import { decodeTiffToPng } from "./decodeTiffToPng";

self.onmessage = async ({ data }: MessageEvent<Uint8Array>) => {
  try {
    self.postMessage(await decodeTiffToPng(data));
  } catch (error) {
    self.postMessage(error instanceof Error ? error : new Error(String(error)));
  }
};
