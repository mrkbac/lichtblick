// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, toNanoSec } from "@foxglove/rostime";

import { VideoPlayer, canonicalVideoCodec, isVideoKeyframe } from "@lichtblick/den/video";
import { Immutable, MessageEvent } from "@lichtblick/suite";
import { PartialMessage } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtension";
import { WorkerImageDecoder } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { isCompressedDepthFormat } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeCompressedDepth";
import {
  decodeCompressedImageToBitmap,
  prepareVideoFrame,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeImage";
import {
  normalizeCompressedImage,
  normalizeCompressedVideo,
  normalizeRawImage,
  normalizeRosCompressedImage,
  normalizeRosImage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/imageNormalizers";
import { PreparedVideoFrameStatus } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/types";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";

import { imageKind } from "./layout";
import { TileConfig } from "./types";

export type TileElements = {
  canvas: HTMLCanvasElement;
  timestamp: HTMLElement;
  status: HTMLElement;
};

type VideoState = {
  /**
   * Frames not yet fed to the decoder. Every delta frame is needed, but nothing before the newest
   * keyframe, so the queue never grows past one GOP.
   */
  queue: Immutable<MessageEvent>[];
  player?: VideoPlayer;
  /** Stream start; decoder timestamps are microseconds relative to it. */
  firstTime?: bigint;
  lastTime?: bigint;
  /** Delta frames are skipped until a keyframe (re)initializes the decoder. */
  waitingForKeyframe: boolean;
  /** Bumped on every reset, so frames decoded before a seek are never painted after it. */
  epoch: number;
  /** `performance.now()` of the last paint, to keep painting while decoding lags behind. */
  lastPaint: number;
};

/** Longest a tile goes without a paint while its decoder works through a backlog. */
const MAX_PAINT_INTERVAL_MS = 100;

/** Queues a video frame, dropping everything a keyframe makes unnecessary. */
export function enqueueVideoFrame(
  queue: Immutable<MessageEvent>[],
  event: Immutable<MessageEvent>,
): void {
  // Normalized because JSON-encoded messages carry `data` as a number array.
  const { format, data } = normalizeCompressedVideo(event.message as PartialMessage<never>);
  if (isVideoKeyframe(format, data)) {
    queue.length = 0;
  }
  queue.push(event);
}

type TileState = {
  /** Newest message received for the topic. */
  latest?: Immutable<MessageEvent>;
  /** Message currently decoded into `bitmap` (or that failed to decode). */
  drawn?: Immutable<MessageEvent>;
  decoding: boolean;
  bitmap?: ImageBitmap;
  /** Formatted timestamp of `bitmap`, restored when the tile remounts. */
  stampText?: string;
  elements?: TileElements;
  config?: TileConfig;
  video?: VideoState;
};

/**
 * Decodes and draws the latest image of each topic onto a plain 2D canvas, outside of React so
 * incoming messages never cause a re-render. At most one decode per topic is in flight; frames
 * that arrive meanwhile replace each other and only the newest one is decoded afterwards.
 */
export class GridRenderer {
  #tiles = new Map<string, TileState>();
  #worker?: WorkerImageDecoder;
  #resizeObserver?: ResizeObserver;
  #onAspectChange: () => void;
  #waitingText: string;

  /** `waitingText` is shown on a tile until its first image is drawn. */
  public constructor(onAspectChange: () => void, waitingText: string) {
    this.#onAspectChange = onAspectChange;
    this.#waitingText = waitingText;
  }

  public setFrame(messages: Immutable<MessageEvent[]>): void {
    const updated = new Set<TileState>();
    for (const event of messages) {
      const tile = this.#tiles.get(event.topic);
      if (!tile) {
        continue;
      }
      if (imageKind(event.schemaName) === "video") {
        tile.video ??= { queue: [], waitingForKeyframe: true, epoch: 0, lastPaint: 0 };
        enqueueVideoFrame(tile.video.queue, event);
      } else {
        tile.latest = event;
      }
      updated.add(tile);
    }
    for (const tile of updated) {
      void this.#update(tile);
    }
  }

  /** Drops queued video frames and restarts decoding at the next keyframe (the player backfills it). */
  public seek(): void {
    for (const tile of this.#tiles.values()) {
      if (tile.video) {
        resetVideo(tile.video);
        tile.video.queue.length = 0;
      }
    }
  }

  /** Width / height of the last decoded image of `topic`, before rotation. */
  public aspect(topic: string): number | undefined {
    const bitmap = this.#tiles.get(topic)?.bitmap;
    return bitmap && bitmap.height > 0 ? bitmap.width / bitmap.height : undefined;
  }

  /** Keeps state (including the latest message) only for these topics. */
  public setTopics(topics: readonly string[]): void {
    const keep = new Set(topics);
    for (const [topic, tile] of this.#tiles) {
      if (!keep.has(topic)) {
        tile.bitmap?.close();
        tile.video?.player?.close();
        this.#tiles.delete(topic);
      }
    }
    for (const topic of keep) {
      if (!this.#tiles.has(topic)) {
        this.#tiles.set(topic, { decoding: false });
      }
    }
  }

  public attach(topic: string, elements: TileElements, config: TileConfig): void {
    const tile = this.#tiles.get(topic) ?? { decoding: false };
    this.#tiles.set(topic, tile);
    tile.elements = elements;
    tile.config = config;
    tile.drawn = undefined;
    elements.timestamp.textContent = tile.stampText ?? "";
    // A remounted tile shows its last frame (redrawn on the first resize) instead of waiting text.
    this.#showStatus(tile, tile.bitmap ? undefined : this.#waitingText);
    this.#resizeObserver ??= new ResizeObserver((entries) => {
      this.#handleResize(entries);
    });
    this.#resizeObserver.observe(elements.canvas);
  }

  public detach(topic: string): void {
    const tile = this.#tiles.get(topic);
    if (!tile?.elements) {
      return;
    }
    // Keep the last frame and the video decoder, so a tile unmounted by maximizing another one
    // reappears unchanged even while paused. Both are released in setTopics and dispose.
    this.#resizeObserver?.unobserve(tile.elements.canvas);
    tile.elements = undefined;
    tile.drawn = undefined;
  }

  public setTileConfig(config: TileConfig): void {
    const tile = this.#tiles.get(config.topic);
    if (tile) {
      tile.config = config;
      this.#draw(tile);
    }
  }

  /**
   * Stops the decode worker and video decoders and releases all bitmaps. The renderer stays usable
   * (both are recreated on demand), so effect re-runs don't lose the tiles' latest messages.
   */
  public dispose(): void {
    // Decodes pending in the terminated worker never settle; don't let them block their tiles.
    for (const tile of this.#tiles.values()) {
      tile.decoding = false;
    }
    this.#worker?.terminate();
    this.#worker = undefined;
    for (const tile of this.#tiles.values()) {
      tile.bitmap?.close();
      tile.bitmap = undefined;
      tile.stampText = undefined;
      tile.video?.player?.close();
      tile.video = undefined;
    }
  }

  #handleResize(entries: ResizeObserverEntry[]): void {
    const dpr = window.devicePixelRatio;
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement;
      canvas.width = Math.round(entry.contentRect.width * dpr);
      canvas.height = Math.round(entry.contentRect.height * dpr);
      for (const tile of this.#tiles.values()) {
        if (tile.elements?.canvas === canvas) {
          this.#draw(tile);
          // A tile that was hidden (zero size) may have a pending frame.
          void this.#update(tile);
        }
      }
    }
  }

  /** Decodes and draws the tile's newest frame, repeating until no newer frame has arrived. */
  async #update(tile: TileState): Promise<void> {
    if (tile.decoding) {
      return;
    }
    tile.decoding = true;
    try {
      // A loop rather than recursion, so continuous playback doesn't build an ever-growing promise chain.
      for (;;) {
        const { latest: event, elements, video } = tile;
        // Stop when unmounted or hidden (zero size, e.g. inactive tab).
        if (!elements || elements.canvas.width === 0 || elements.canvas.height === 0) {
          return;
        }
        if (video) {
          const frame = video.queue.shift();
          if (!frame) {
            return;
          }
          await this.#decodeVideoAndDraw(tile, video, frame, elements);
          continue;
        }
        if (!event || event === tile.drawn) {
          return;
        }
        await this.#decodeAndDraw(tile, event, elements);
      }
    } finally {
      tile.decoding = false;
    }
  }

  async #decodeAndDraw(
    tile: TileState,
    event: Immutable<MessageEvent>,
    elements: TileElements,
  ): Promise<void> {
    try {
      const { bitmap, stamp } = await this.#decode(event);
      this.#show(tile, event, elements, bitmap, stamp);
    } catch (error) {
      if (tile.elements === elements) {
        tile.drawn = event;
        this.#showStatus(tile, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /** Feeds one frame to the tile's decoder; only the newest queued frame is drawn. */
  async #decodeVideoAndDraw(
    tile: TileState,
    video: VideoState,
    event: Immutable<MessageEvent>,
    elements: TileElements,
  ): Promise<void> {
    let frame: VideoFrame | undefined;
    try {
      const message = normalizeCompressedVideo(event.message as PartialMessage<never>);
      if (canonicalVideoCodec(message.format) == undefined) {
        throw new Error(`Unsupported video format "${message.format}"`);
      }
      if (!video.player) {
        if (!VideoPlayer.IsSupported()) {
          throw new Error("WebCodecs VideoDecoder is not available in this browser");
        }
        const player = new VideoPlayer();
        player.on("error", () => {
          resetVideo(video);
        });
        video.player = player;
      }
      const time = toNanoSec(message.timestamp);
      if (video.lastTime != undefined && time < video.lastTime) {
        resetVideo(video); // jumped backwards (seek or loop) without a seek notification
      }
      video.lastTime = time;

      const prepared = prepareVideoFrame(message);
      if (prepared.status === PreparedVideoFrameStatus.UnsupportedBitstream) {
        throw new Error(prepared.diagnostics ?? "Unsupported video bitstream");
      }
      if (prepared.status === PreparedVideoFrameStatus.UnsupportedBFrame) {
        return;
      }
      // A seek during any await below invalidates this frame.
      const epoch = video.epoch;
      if (video.waitingForKeyframe || !video.player.isInitialized()) {
        if (prepared.type !== "key" || !prepared.decoderConfig) {
          return;
        }
        await video.player.init(prepared.decoderConfig);
        if (video.epoch !== epoch) {
          return;
        }
        video.waitingForKeyframe = false;
        video.firstTime = time;
      }
      const firstTime = video.firstTime ?? time;
      frame = await video.player.decode(
        prepared.data,
        Number((time - firstTime) / 1000n),
        prepared.type,
      );
      // Older frames only keep the decoder's reference chain intact, unless decoding lags so far
      // behind that the queue never empties; then paint periodically instead of freezing.
      const now = performance.now();
      if (frame && (video.queue.length === 0 || now - video.lastPaint >= MAX_PAINT_INTERVAL_MS)) {
        video.lastPaint = now;
        const bitmap = await createImageBitmap(frame);
        if (video.epoch !== epoch) {
          bitmap.close(); // a seek happened meanwhile; this frame is from before it
          return;
        }
        this.#show(tile, event, elements, bitmap, message.timestamp);
      }
    } catch (error) {
      if (tile.elements === elements) {
        this.#showStatus(tile, error instanceof Error ? error.message : String(error));
      }
    } finally {
      frame?.close();
    }
  }

  /** Swaps in a freshly decoded bitmap, or discards it if the tile was unmounted meanwhile. */
  #show(
    tile: TileState,
    event: Immutable<MessageEvent>,
    elements: TileElements,
    bitmap: ImageBitmap,
    stamp: Time,
  ): void {
    if (tile.elements !== elements) {
      bitmap.close();
      return;
    }
    const previousAspect = this.aspect(event.topic);
    tile.bitmap?.close();
    tile.bitmap = bitmap;
    tile.drawn = event;
    tile.stampText = formatTimeRaw(stamp);
    elements.timestamp.textContent = tile.stampText;
    this.#showStatus(tile, undefined);
    this.#draw(tile);
    const aspect = bitmap.width / bitmap.height;
    if (previousAspect == undefined || Math.abs(previousAspect - aspect) > 0.01) {
      this.#onAspectChange();
    }
  }

  async #decode(event: Immutable<MessageEvent>): Promise<{ bitmap: ImageBitmap; stamp: Time }> {
    const message = event.message as PartialMessage<never>;
    const kind = imageKind(event.schemaName);
    switch (kind) {
      case "compressed-ros":
      case "compressed-foxglove": {
        const image =
          kind === "compressed-ros"
            ? normalizeRosCompressedImage(message)
            : normalizeCompressedImage(message);
        const stamp = "header" in image ? image.header.stamp : image.timestamp;
        if (isCompressedDepthFormat(image.format)) {
          this.#worker ??= new WorkerImageDecoder();
          return { bitmap: await createImageBitmap(await this.#worker.decode(image, {})), stamp };
        }
        return { bitmap: await decodeCompressedImageToBitmap(image), stamp };
      }
      case "raw-ros":
      case "raw-foxglove": {
        const image = kind === "raw-ros" ? normalizeRosImage(message) : normalizeRawImage(message);
        const stamp = "header" in image ? image.header.stamp : image.timestamp;
        // Raw decoding (debayering, color mapping) runs off the main thread.
        this.#worker ??= new WorkerImageDecoder();
        const imageData = await this.#worker.decode(image, {});
        return { bitmap: await createImageBitmap(imageData), stamp };
      }
      case "video":
      case undefined:
        throw new Error(`Unsupported schema ${event.schemaName}`);
    }
  }

  #showStatus(tile: TileState, text: string | undefined): void {
    const status = tile.elements?.status;
    if (status) {
      status.textContent = text ?? "";
      status.hidden = text == undefined;
    }
  }

  #draw(tile: TileState): void {
    const { elements, bitmap, config } = tile;
    const ctx = elements?.canvas.getContext("2d");
    if (!ctx || !config) {
      return;
    }
    const { width, height } = ctx.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!bitmap) {
      return;
    }
    const quarterTurn = config.rotation === 90 || config.rotation === 270;
    const rotatedWidth = quarterTurn ? bitmap.height : bitmap.width;
    const rotatedHeight = quarterTurn ? bitmap.width : bitmap.height;
    const scale = (config.fit === "fill" ? Math.max : Math.min)(
      width / rotatedWidth,
      height / rotatedHeight,
    );
    ctx.imageSmoothingQuality = "medium";
    ctx.translate(width / 2, height / 2);
    ctx.rotate((config.rotation * Math.PI) / 180);
    ctx.scale(scale * (config.flipHorizontal ? -1 : 1), scale * (config.flipVertical ? -1 : 1));
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  }
}

/** Restarts decoding at the next keyframe and invalidates frames still being decoded. */
function resetVideo(video: VideoState): void {
  video.epoch++;
  video.player?.resetForSeek();
  video.waitingForKeyframe = true;
  video.firstTime = undefined;
  video.lastTime = undefined;
}
