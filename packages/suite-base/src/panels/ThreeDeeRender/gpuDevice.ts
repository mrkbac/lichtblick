// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

let sharedDevice: Promise<GPUDevice | undefined> | undefined;

/**
 * The WebGPU device every 3D panel renders with, or undefined without WebGPU.
 *
 * One long-lived device instead of one per renderer: closing a panel must not destroy a device
 * whose pipelines are still compiling (three.js awaits their error scopes and would reject), and
 * panels share one GPU anyway. It asks for the adapter's buffer limits, since WebGPU's default of
 * 128 MB per storage binding is too small for accumulated point clouds (12 bytes per point for
 * positions alone). A lost device is replaced on the next request.
 */
export async function getGpuDevice(): Promise<GPUDevice | undefined> {
  // A failed request isn't cached, so a reopened panel tries again
  sharedDevice ??= requestDevice().catch((error: unknown) => {
    sharedDevice = undefined;
    throw error;
  });
  return await sharedDevice;
}

async function requestDevice(): Promise<GPUDevice | undefined> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return undefined;
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    return undefined;
  }
  const device = await adapter.requestDevice({
    // three.js uses what's there (e.g. timestamp queries for the stats overlay)
    requiredFeatures: [...adapter.features] as GPUFeatureName[],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  void device.lost.then(() => {
    sharedDevice = undefined;
  });
  return device;
}
