// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef, useState } from "react";

import type { Renderer } from "./Renderer";

/** Minimum time between automatic recreations, so a flapping GPU can't remount in a loop */
export const MIN_AUTO_RECREATE_INTERVAL_MS = 30_000;

/**
 * "restoring" = device lost, recreating; "paused" = lost again soon after, waiting for the user;
 * "unsupported" = no WebGPU (the panel needs it).
 */
export type GpuStatus = "ok" | "restoring" | "paused" | "unsupported";

/**
 * Recovers from a lost WebGPU device by bumping `canvasKey` (the canvas's React key), so the panel
 * remounts it and builds a new renderer from the persisted config.
 */
export function useGpuRecovery(renderer: Renderer | undefined): {
  canvasKey: number;
  status: GpuStatus;
  recreate: () => void;
} {
  const [canvasKey, setCanvasKey] = useState(0);
  const [status, setStatus] = useState<GpuStatus>("ok");
  const lastAutoRecreateRef = useRef(-Infinity);

  const recreate = useCallback(() => {
    setStatus("ok");
    setCanvasKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!renderer) {
      return;
    }
    const onLost = () => {
      if (performance.now() - lastAutoRecreateRef.current < MIN_AUTO_RECREATE_INTERVAL_MS) {
        setStatus("paused");
        return;
      }
      lastAutoRecreateRef.current = performance.now();
      setStatus("restoring");
      recreate();
    };
    const onUnsupported = () => {
      setStatus("unsupported");
    };
    // Startup settles here, even when it failed or lost the device before this effect subscribed.
    // A renderer that started fine clears the status left by the one it replaced (e.g. "paused"
    // when the stats setting rebuilt the renderer without `recreate`).
    let current = true;
    void renderer.ready.then(() => {
      if (!current) {
        return;
      }
      if (renderer.gpuError) {
        onUnsupported();
      } else if (renderer.gpuLost) {
        onLost();
      } else {
        setStatus("ok");
      }
    });
    renderer.addListener("gpuLost", onLost);
    renderer.addListener("gpuUnsupported", onUnsupported);
    return () => {
      current = false;
      renderer.removeListener("gpuLost", onLost);
      renderer.removeListener("gpuUnsupported", onUnsupported);
    };
  }, [renderer, recreate]);

  return { canvasKey, status, recreate };
}
