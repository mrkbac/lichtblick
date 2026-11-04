/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import type * as THREE from "three";

import {
  MIN_AUTO_RECREATE_INTERVAL_MS,
  RESTORE_TIMEOUT_MS,
  useWebGLContextRecovery,
} from "./useWebGLContextRecovery";

function loseContext(canvas: HTMLCanvasElement): Event {
  const event = new Event("webglcontextlost", { cancelable: true });
  act(() => {
    canvas.dispatchEvent(event);
  });
  return event;
}

describe("useWebGLContextRecovery", () => {
  const forceContextLoss = vi.fn();
  const gl = { forceContextLoss } as unknown as THREE.WebGLRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const canvas = document.createElement("canvas");
    const hook = renderHook(
      ({ target }: { target: HTMLCanvasElement }) => useWebGLContextRecovery(target, gl),
      { initialProps: { target: canvas } },
    );
    return { canvas, hook };
  }

  it("allows restore on loss and recreates the canvas when the browser restores it", () => {
    const { canvas, hook } = setup();

    const event = loseContext(canvas);

    expect(event.defaultPrevented).toBe(true);
    expect(hook.result.current.status).toBe("restoring");
    expect(hook.result.current.canvasKey).toBe(0);

    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    expect(hook.result.current.status).toBe("ok");
    expect(hook.result.current.canvasKey).toBe(1);
  });

  it("recreates the canvas itself when the browser does not restore in time", () => {
    const { canvas, hook } = setup();

    loseContext(canvas);
    act(() => {
      vi.advanceTimersByTime(RESTORE_TIMEOUT_MS);
    });

    expect(hook.result.current.status).toBe("ok");
    expect(hook.result.current.canvasKey).toBe(1);
  });

  it("waits for the user instead of auto-recreating again soon after the last recreation", () => {
    const { canvas, hook } = setup();
    loseContext(canvas);
    act(() => {
      vi.advanceTimersByTime(RESTORE_TIMEOUT_MS);
    });

    // The recreated canvas is lost again, e.g. evicted because too many contexts are open
    const nextCanvas = document.createElement("canvas");
    hook.rerender({ target: nextCanvas });
    loseContext(nextCanvas);
    act(() => {
      vi.advanceTimersByTime(RESTORE_TIMEOUT_MS);
    });

    expect(hook.result.current.status).toBe("paused");
    expect(hook.result.current.canvasKey).toBe(1);

    act(() => {
      hook.result.current.recreate();
    });
    expect(hook.result.current.status).toBe("ok");
    expect(hook.result.current.canvasKey).toBe(2);

    // Auto-recreation resumes once the interval has passed
    const thirdCanvas = document.createElement("canvas");
    hook.rerender({ target: thirdCanvas });
    act(() => {
      vi.advanceTimersByTime(MIN_AUTO_RECREATE_INTERVAL_MS);
    });
    loseContext(thirdCanvas);
    expect(hook.result.current.status).toBe("restoring");
  });

  it("counts a browser restore toward the auto-recreate interval", () => {
    const { canvas, hook } = setup();
    loseContext(canvas);
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    const nextCanvas = document.createElement("canvas");
    hook.rerender({ target: nextCanvas });
    loseContext(nextCanvas);

    expect(hook.result.current.status).toBe("paused");
  });

  it("releases the context when the canvas goes away and stops listening", () => {
    const { canvas, hook } = setup();

    hook.unmount();

    expect(forceContextLoss).toHaveBeenCalledTimes(1);
    const event = loseContext(canvas);
    expect(event.defaultPrevented).toBe(false);
  });
});
