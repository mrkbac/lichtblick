// SPDX-License-Identifier: MPL-2.0

import { loadDecompressHandlers } from "@lichtblick/mcap-support";

import type { DecompressReply, DecompressRequest } from "./DecompressPool";

// Decompresses chunks for DecompressPool. Says "ready" once its decompressors are loaded; until
// then the pool sends it nothing.
const scope = self as unknown as {
  postMessage(message: DecompressReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<DecompressRequest>) => void) | null;
};

void loadDecompressHandlers().then((handlers) => {
  scope.onmessage = ({ data: { id, compression, buffer, decompressedSize } }) => {
    try {
      const decompress = handlers[compression];
      if (!decompress) {
        throw new Error(`Unsupported compression ${compression}`);
      }
      const result = decompress(buffer, decompressedSize);
      // Each decompressor returns a fresh copy, so its buffer can be moved, not copied
      scope.postMessage({ id, result }, [result.buffer as ArrayBuffer]);
    } catch (error) {
      scope.postMessage({ id, error: String(error) });
    }
  };
  scope.postMessage({ ready: true });
});
