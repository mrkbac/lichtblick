// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TIFF_DECODE_TIMEOUT_MS, tiffToPng } from "./tiffToPng";

describe("tiffToPng", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("terminates a worker that never finishes decoding", async () => {
    // Given: a worker stuck on a malformed file
    vi.useFakeTimers();
    const terminate = vi.fn();
    vi.stubGlobal(
      "Worker",
      class {
        public postMessage() {}
        public terminate = terminate;
      },
    );
    // When
    const result = tiffToPng(new Uint8Array([0x49, 0x49, 42, 0])).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(TIFF_DECODE_TIMEOUT_MS);
    // Then
    expect(((await result) as Error).message).toContain("took longer");
    expect(terminate).toHaveBeenCalled();
  });
});
