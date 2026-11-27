/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable, MessageEvent } from "@lichtblick/suite";
import { PreparedVideoFrameStatus } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/types";

import { GridRenderer, MAX_QUEUED_VIDEO_FRAMES } from "./GridRenderer";
import { makeTile } from "./types";

const decoded: number[] = [];
vi.mock("@lichtblick/den/video", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  VideoPlayer: class {
    #initialized = false;
    public static IsSupported() {
      return true;
    }
    public on() {}
    public async init() {
      this.#initialized = true;
    }
    public isInitialized() {
      return this.#initialized;
    }
    public async decode(data: Uint8Array) {
      decoded.push(data[0]!);
      return { close: () => {} };
    }
    public resetForSeek() {}
    public close() {}
  },
}));
vi.mock(
  "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeImage",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    prepareVideoFrame: ({ data }: { data: Uint8Array }) => ({
      status: PreparedVideoFrameStatus.Ok,
      type: data[0] === 0 ? "key" : "delta",
      data,
      decoderConfig: {},
    }),
  }),
);

const KEY = [0, 0, 0, 1, 0x65, 0x88, 0x84, 0x21]; // H.264 IDR
const delta = (n: number) => [n, 0, 0, 1, 0x61, 0x88, 0x84, 0x21];
let sec = 0;
const frame = (data: number[]): Immutable<MessageEvent> => ({
  topic: "/video",
  schemaName: "foxglove.CompressedVideo",
  receiveTime: { sec: sec++, nsec: 0 },
  sizeInBytes: data.length,
  message: { format: "h264", data: new Uint8Array(data), timestamp: { sec, nsec: 0 } },
});
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

it("keeps decoding a hidden video tile, so a stream without new keyframes isn't frozen", async () => {
  let onResize: ResizeObserverCallback = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      public constructor(callback: ResizeObserverCallback) {
        onResize = callback;
      }
      public observe() {}
      public unobserve() {}
      public disconnect() {}
    },
  );
  const createImageBitmap = vi.fn(async () => ({ width: 4, height: 3, close: () => {} }));
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  // Given a hidden (zero size) tile on a stream whose only keyframe is its first frame
  const renderer = new GridRenderer(() => {}, "");
  renderer.setTopics(["/video"], new Map());
  const canvas = document.createElement("canvas");
  canvas.width = 0;
  canvas.height = 0;
  const elements = {
    canvas,
    timestamp: document.createElement("div"),
    status: document.createElement("div"),
  };
  renderer.attach("/video", elements, makeTile("/video"));
  renderer.setFrame([frame(KEY)]);
  await flush();

  // When more delta frames arrive than a tile could queue
  for (let i = 1; i <= MAX_QUEUED_VIDEO_FRAMES + 10; i++) {
    renderer.setFrame([frame(delta(i % 200))]);
    await flush();
  }
  // Then each was decoded, but none painted while hidden
  expect(decoded).toHaveLength(MAX_QUEUED_VIDEO_FRAMES + 11);
  expect(createImageBitmap).not.toHaveBeenCalled();

  // When the tile is shown, its newest frame is painted right away
  onResize(
    [{ target: canvas, contentRect: { width: 40, height: 30 } } as unknown as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  await flush();
  expect(createImageBitmap).toHaveBeenCalledTimes(1);
  renderer.dispose();
});
