// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@lichtblick/rostime";
import { Immutable, MessageEvent } from "@lichtblick/suite";
import { PartialMessage } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtension";
import { WorkerImageDecoder } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/WorkerImageDecoder";
import { decodeCompressedImageToBitmap } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/decodeImage";
import {
  normalizeCompressedImage,
  normalizeRawImage,
  normalizeRosCompressedImage,
  normalizeRosImage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/imageNormalizers";
import { formatTimeRaw } from "@lichtblick/suite-base/util/time";

import { imageKind } from "./layout";
import { TileConfig } from "./types";

export type TileElements = {
  canvas: HTMLCanvasElement;
  timestamp: HTMLElement;
  status: HTMLElement;
};

type TileState = {
  /** Newest message received for the topic. */
  latest?: Immutable<MessageEvent>;
  /** Message currently decoded into `bitmap` (or that failed to decode). */
  drawn?: Immutable<MessageEvent>;
  decoding: boolean;
  bitmap?: ImageBitmap;
  elements?: TileElements;
  config?: TileConfig;
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
      if (tile) {
        tile.latest = event;
        updated.add(tile);
      }
    }
    for (const tile of updated) {
      void this.#update(tile);
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
    this.#showStatus(tile, this.#waitingText);
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
    this.#resizeObserver?.unobserve(tile.elements.canvas);
    tile.elements = undefined;
    tile.drawn = undefined;
    tile.bitmap?.close();
    tile.bitmap = undefined;
  }

  public setTileConfig(config: TileConfig): void {
    const tile = this.#tiles.get(config.topic);
    if (tile) {
      tile.config = config;
      this.#draw(tile);
    }
  }

  /**
   * Stops the decode worker. Tiles release their bitmaps and observers on detach, and the renderer
   * stays usable (the worker is recreated on demand) so effect re-runs don't lose tile state.
   */
  public dispose(): void {
    // Decodes pending in the terminated worker never settle; don't let them block their tiles.
    for (const tile of this.#tiles.values()) {
      tile.decoding = false;
    }
    this.#worker?.terminate();
    this.#worker = undefined;
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
        const { latest: event, elements } = tile;
        // Stop when unmounted, up to date, or hidden (zero size, e.g. inactive tab).
        if (
          !elements ||
          !event ||
          event === tile.drawn ||
          elements.canvas.width === 0 ||
          elements.canvas.height === 0
        ) {
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
      if (tile.elements === elements) {
        const previousAspect = this.aspect(event.topic);
        tile.bitmap?.close();
        tile.bitmap = bitmap;
        tile.drawn = event;
        elements.timestamp.textContent = formatTimeRaw(stamp);
        this.#showStatus(tile, undefined);
        this.#draw(tile);
        const aspect = bitmap.width / bitmap.height;
        if (previousAspect == undefined || Math.abs(previousAspect - aspect) > 0.01) {
          this.#onAspectChange();
        }
      } else {
        // The tile was unmounted (or remounted) while decoding.
        bitmap.close();
      }
    } catch (error) {
      if (tile.elements === elements) {
        tile.drawn = event;
        this.#showStatus(tile, error instanceof Error ? error.message : String(error));
      }
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
