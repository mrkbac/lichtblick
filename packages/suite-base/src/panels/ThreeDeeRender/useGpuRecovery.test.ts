/** @vitest-environment jsdom */
/* oxlint-disable @lichtblick/license-header -- New fork files must not claim BMW copyright. */
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import EventEmitter from "eventemitter3";

import type { Renderer } from "./Renderer";
import { useGpuRecovery } from "./useGpuRecovery";

function fakeRenderer({ gpuLost = false } = {}): Renderer & EventEmitter {
  return Object.assign(new EventEmitter(), {
    ready: Promise.resolve(),
    gpuError: undefined,
    gpuLost,
  }) as unknown as Renderer & EventEmitter;
}

describe("useGpuRecovery", () => {
  it("pauses on a second loss, and clears that when a replacement renderer starts", async () => {
    const first = fakeRenderer();
    const { result, rerender } = renderHook(({ renderer }) => useGpuRecovery(renderer), {
      initialProps: { renderer: first },
    });
    await act(async () => {
      first.emit("gpuLost", first);
    });
    expect(result.current.status).toBe("ok"); // recreated right away
    await act(async () => {
      first.emit("gpuLost", first);
    });
    expect(result.current.status).toBe("paused");

    // e.g. the stats setting rebuilt the renderer without `recreate`
    await act(async () => {
      rerender({ renderer: fakeRenderer() });
    });
    expect(result.current.status).toBe("ok");
  });

  it("recovers a renderer that lost its device while starting", async () => {
    const { result } = renderHook(() => useGpuRecovery(fakeRenderer({ gpuLost: true })));
    await act(async () => {});
    expect(result.current.canvasKey).toBe(1);
  });
});
