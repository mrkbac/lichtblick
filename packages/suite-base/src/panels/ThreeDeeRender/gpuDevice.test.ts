/** @vitest-environment jsdom */
/* oxlint-disable @lichtblick/license-header -- New fork files must not claim BMW copyright. */
// SPDX-License-Identifier: MPL-2.0

import { getGpuDevice } from "./gpuDevice";

describe("getGpuDevice", () => {
  it("asks again after a failed device request, and shares the device it gets", async () => {
    const device = { lost: new Promise(() => {}) };
    const requestDevice = vi
      .fn()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce(device);
    Object.defineProperty(navigator, "gpu", {
      value: {
        requestAdapter: async () => ({
          features: new Set(),
          limits: {
            maxStorageBufferBindingSize: 1,
            maxBufferSize: 1,
            maxTextureDimension2D: 16384,
          },
          requestDevice,
        }),
      },
      configurable: true,
    });

    await expect(getGpuDevice()).rejects.toThrow("busy");
    await expect(getGpuDevice()).resolves.toBe(device);
    await expect(getGpuDevice()).resolves.toBe(device);
    expect(requestDevice).toHaveBeenCalledTimes(2);
    expect(requestDevice).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requiredLimits: expect.objectContaining({ maxTextureDimension2D: 16384 }),
      }),
    );
  });
});
