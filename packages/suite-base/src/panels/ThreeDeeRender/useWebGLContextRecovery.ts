// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef, useState } from "react";
import { useLatest } from "react-use";
import type * as THREE from "three";

/** How long to wait for the browser to restore a lost context before recreating it ourselves. */
export const RESTORE_TIMEOUT_MS = 2_000;
/**
 * Minimum time between automatic recreations. Browsers cap live WebGL contexts (~16); recreating
 * evicts the oldest one, so with too many panels open, automatic recreation would cycle forever.
 */
export const MIN_AUTO_RECREATE_INTERVAL_MS = 30_000;

/** "restoring" = lost, recreation pending; "paused" = lost, waiting for the user to recreate. */
export type ContextLossStatus = "ok" | "restoring" | "paused";

/**
 * Recovers from WebGL context loss by recreating the canvas: bump `canvasKey` (used as the
 * canvas's React key) so the panel remounts it and builds a new renderer from the persisted config.
 * Also releases the context when the canvas goes away so closed panels don't count toward the
 * browser's context limit.
 */
export function useWebGLContextRecovery(
  canvas: HTMLCanvasElement | null,
  gl: THREE.WebGLRenderer | undefined,
): { canvasKey: number; status: ContextLossStatus; recreate: () => void } {
  const [canvasKey, setCanvasKey] = useState(0);
  const [status, setStatus] = useState<ContextLossStatus>("ok");
  const lastAutoRecreateRef = useRef(-Infinity);
  const glRef = useLatest(gl);

  const recreate = useCallback(() => {
    setStatus("ok");
    setCanvasKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!canvas) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onLost = (event: Event) => {
      // Tell the browser we can handle a restore; otherwise it never fires webglcontextrestored.
      event.preventDefault();
      clearTimeout(timeout);
      if (performance.now() - lastAutoRecreateRef.current < MIN_AUTO_RECREATE_INTERVAL_MS) {
        setStatus("paused");
        return;
      }
      setStatus("restoring");
      timeout = setTimeout(() => {
        lastAutoRecreateRef.current = performance.now();
        recreate();
      }, RESTORE_TIMEOUT_MS);
    };
    // A restored context has lost all GPU resources; a fresh canvas + renderer re-uploads them.
    // Recreate even when paused: a restore means the browser has room for the context again
    // (evicted contexts are never restored). Count it toward the interval so a flapping GPU
    // can't remount in a loop.
    const onRestored = () => {
      clearTimeout(timeout);
      lastAutoRecreateRef.current = performance.now();
      recreate();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      clearTimeout(timeout);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      // Only on canvas teardown (not on renderer recreation, which reuses the canvas). Disposing
      // the renderer alone leaves the context alive until garbage collection. Reading the latest
      // renderer here is intended: it is the one rendering into this canvas.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      glRef.current?.forceContextLoss();
    };
  }, [canvas, glRef, recreate]);

  return { canvasKey, status, recreate };
}
