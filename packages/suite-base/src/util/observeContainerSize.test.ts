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
      class implements ResizeObserver {
        public constructor(callback: ResizeObserverCallback) {
          notify = (width, height) => {
            callback(
              [
                {
                  target: element,
                  contentRect: new DOMRect(0, 0, width, height),
                  borderBoxSize: [],
                  contentBoxSize: [],
                  devicePixelContentBoxSize: [],
                },
              ],
              this,
            );
          };
        }
        public observe = vi.fn();
        public unobserve = vi.fn();
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
    // Given
    observeContainerSize(element, api);
    // When
    notify(600.4, 350.6);
    // Then
    expect(api.layout).toHaveBeenCalledExactlyOnceWith(600, 351);
  });

  it("uses the owning window observer when the opener is in the background", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const Observer = vi.fn(function (this: ResizeObserver) {
      this.observe = vi.fn();
      this.disconnect = disconnect;
    });
    Object.defineProperty(iframe.contentWindow!, "ResizeObserver", { value: Observer });
    iframe.contentDocument!.body.appendChild(element);
    const cleanup = observeContainerSize(element, api);
    expect(Observer).toHaveBeenCalledOnce();
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    iframe.remove();
  });

  it("skips unchanged dimensions", () => {
    // Given
    observeContainerSize(element, api);
    // When
    notify(400.1, 299.9);
    // Then
    expect(api.layout).not.toHaveBeenCalled();
  });

  it("keeps hidden tabs' sizes and updates them when shown", () => {
    // Given
    observeContainerSize(element, api);
    Object.defineProperty(element, "offsetParent", { configurable: true, value: null });
    // When
    notify(0, 0);
    // Then
    expect(api.layout).not.toHaveBeenCalled();
    Object.defineProperty(element, "offsetParent", { configurable: true, value: document.body });
    notify(500, 300);
    expect(api.layout).toHaveBeenCalledExactlyOnceWith(500, 300);
  });

  it("ignores detached elements and disconnects on cleanup", () => {
    // Given
    const cleanup = observeContainerSize(element, api);
    element.remove();
    // When
    notify(600, 350);
    cleanup();
    // Then
    expect(api.layout).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
