// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
/** @jest-environment jsdom */

import { GridRenderer } from "./GridRenderer";
import { makeTile } from "./types";

it("rebinds resizing and canvas density when a paused grid moves to another window", () => {
  const renderer = new GridRenderer(vi.fn(), "Waiting");
  const frames: HTMLIFrameElement[] = [];
  const disconnects: ReturnType<typeof vi.fn>[] = [];
  for (const ratio of [1, 2, 1]) {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    frames.push(iframe);
    const child = iframe.contentWindow!;
    const doc = child.document;
    const canvas = doc.createElement("canvas");
    const context = { canvas, setTransform: vi.fn(), clearRect: vi.fn() };
    vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    let notify: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    disconnects.push(disconnect);
    Object.defineProperties(child, {
      devicePixelRatio: { value: ratio },
      ResizeObserver: {
        value: class {
          public constructor(callback: ResizeObserverCallback) {
            notify = callback;
          }
          public observe = vi.fn();
          public unobserve = vi.fn();
          public disconnect = disconnect;
        },
      },
    });
    renderer.attach(
      "/image",
      { canvas, timestamp: doc.createElement("span"), status: doc.createElement("span") },
      makeTile("/image"),
    );
    expect(notify).toBeDefined();
    for (const [width, height] of [
      [640, 360],
      [320, 200],
    ] as const) {
      notify!(
        [
          {
            target: canvas,
            contentRect: new DOMRect(0, 0, width, height),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        {} as ResizeObserver,
      );
      expect(canvas.width).toBe(width * ratio);
      expect(canvas.height).toBe(height * ratio);
      expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, width * ratio, height * ratio);
    }
    renderer.detach("/image");
    expect(disconnect).toHaveBeenCalledOnce();
  }
  renderer.dispose();
  frames.forEach((iframe) => {
    iframe.remove();
  });
  vi.restoreAllMocks();
});
