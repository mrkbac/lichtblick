/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { observeContainerSize } from "./observeContainerSize";

describe("observeContainerSize", () => {
  let notify: (width: number, height: number) => void;
  const disconnect = vi.fn();
  const api = { width: 400, height: 300, layout: vi.fn() };
  let element: HTMLDivElement;

  beforeEach(() => {
    element = document.createElement("div");
    document.body.appendChild(element);
    Object.defineProperty(element, "offsetParent", { configurable: true, value: document.body });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        public constructor(callback: ResizeObserverCallback) {
          notify = (width, height) => {
            callback(
              [{ target: element, contentRect: { width, height } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            );
          };
        }
        public observe = vi.fn();
        public disconnect = disconnect;
      },
    );
  });

  afterEach(() => {
    element.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lays out in the observer callback, without waiting for a frame", () => {
    observeContainerSize(element, api);
    notify(600.4, 350.6);
    expect(api.layout).toHaveBeenCalledExactlyOnceWith(600, 351);
  });

  it("skips unchanged dimensions", () => {
    observeContainerSize(element, api);
    notify(400.1, 299.9);
    expect(api.layout).not.toHaveBeenCalled();
  });

  it("keeps hidden tabs' sizes and updates them when shown", () => {
    observeContainerSize(element, api);
    Object.defineProperty(element, "offsetParent", { configurable: true, value: null });
    notify(0, 0);
    expect(api.layout).not.toHaveBeenCalled();
    Object.defineProperty(element, "offsetParent", { configurable: true, value: document.body });
    notify(500, 300);
    expect(api.layout).toHaveBeenCalledExactlyOnceWith(500, 300);
  });

  it("ignores detached elements and disconnects on cleanup", () => {
    const cleanup = observeContainerSize(element, api);
    element.remove();
    notify(600, 350);
    expect(api.layout).not.toHaveBeenCalled();
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
