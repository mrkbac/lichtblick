// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import i18next from "i18next";
import * as THREE from "three/webgpu";

import type { MessageEvent } from "@lichtblick/suite";
import { DynamicBufferGeometry } from "@lichtblick/suite-base/panels/ThreeDeeRender/DynamicBufferGeometry";
import { BaseUserData, Renderable } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderable";
import type { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import {
  MISSING_TRANSFORM,
  missingTransformMessage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/transforms";
import { MAX_DURATION } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms";
import { updatePose } from "@lichtblick/suite-base/panels/ThreeDeeRender/updatePose";

import { colorHasTransparency } from "./colorMode";
import type { DecayPointRing, RingStyle } from "./pointClouds/DecayPointRing";
import { RasterPoints } from "./pointClouds/RasterPoints";
import type { LayerSettingsPointExtension } from "../settingsNodes/topics";

/**
 * Creates a THREE.Points object for a point cloud and scan messages
 * @param topic - topic name string for naming geometry
 * @param usage - THREE draw usage (ex: THREE.StaticDrawUsage)
 * @returns
 */
export function createGeometry(topic: string, usage: THREE.Usage): DynamicBufferGeometry {
  const geometry = new DynamicBufferGeometry(usage);
  geometry.name = `${topic}:PointScans:geometry`;
  geometry.createAttribute("position", Float32Array, 3);
  geometry.createAttribute("color", Uint8Array, 4, true);
  return geometry;
}

export function pointCloudColorEncoding<T extends LayerSettingsPointExtension>(
  settings: T,
): "srgb" | "linear" {
  switch (settings.colorMode) {
    case "flat":
    case "colormap":
    case "gradient":
      // converted to linear by getColorConverter
      return "linear";
    case "rgb":
    case "rgba":
    case "rgba-fields":
      return "srgb";
  }
}

const tempPoint = new THREE.Vector3();

/** How a point layer draws its points, from its settings */
export function pointStyle<T extends LayerSettingsPointExtension>(settings: T): RingStyle {
  const shape = settings.pointShape;
  return {
    shape: shape === "cube" || shape === "sphere" ? shape : "point",
    square: shape === "square",
    pointSize: settings.pointSize,
    cubeSize: settings.cubeSize,
    outline: settings.showOutlines === true,
    transparent: colorHasTransparency(settings),
    encoding: pointCloudColorEncoding(settings),
  };
}

/**
 * Points decoded into a geometry's position/color arrays (CPU), drawn by a {@link RasterPoints}
 * that reads those same arrays. Picking reports the point index as the instance.
 */
export class PointsRenderable<TUserData extends BaseUserData = BaseUserData> extends Renderable<
  TUserData,
  /*TRenderer=*/ undefined
> {
  public readonly geometry: DynamicBufferGeometry;
  public override pickableInstances = true;
  readonly #points: RasterPoints;
  /** Attribute versions last uploaded */
  #uploaded = { position: -1, color: -1 };

  public constructor(name: string, userData: TUserData, geometry: DynamicBufferGeometry) {
    super(name, undefined, userData);
    this.geometry = geometry;
    this.#points = new RasterPoints(`${userData.topic}:PointCloud:points`);
    this.add(this.#points);
    this.#points.userData.computeBounds = (box: THREE.Box3) => {
      const positions = this.#points.positionAttribute().array as Float32Array;
      for (let i = 0; i < this.#points.drawCount * 3; i += 3) {
        tempPoint.fromArray(positions, i);
        if (Number.isFinite(tempPoint.x + tempPoint.y + tempPoint.z)) {
          box.expandByPoint(tempPoint);
        }
      }
    };
  }

  public override dispose(): void {
    this.#points.dispose();
    this.geometry.dispose();
  }

  public setStyle(style: RingStyle): void {
    const points = this.#points;
    points.pointSize = style.pointSize;
    points.square = style.square;
    points.encoding = style.encoding;
    points.setShape(style.shape, {
      cubeSize: style.cubeSize,
      outline: style.outline,
      transparent: style.transparent,
    });
  }

  /** Points the GPU at the geometry's current arrays and uploads new data; call before rendering */
  public syncPoints(): void {
    const { position, color } = this.geometry.attributes;
    const points = this.#points;
    if (!position || !color) {
      points.drawCount = 0;
      return;
    }
    const count = Math.min(this.geometry.drawRange.count, position.count);
    points.setArrays(position.array as Float32Array, color.array as Uint8Array);
    if (position.version !== this.#uploaded.position || color.version !== this.#uploaded.color) {
      this.#uploaded = { position: position.version, color: color.version };
      points.markRange(0, count);
    }
    points.drawCount = count;
    points.updateShapes();
  }
}

type RenderObjectHistoryUserData = BaseUserData & {
  topic: string;
  settings: LayerSettingsPointExtension;
};

/** An object kept in a decay history. The history owns it and disposes it on eviction. */
export type HistoryRenderable = THREE.Object3D & {
  dispose(): void;
  /** Its draw count is this entry's share of {@link HistoryLimits.maxPoints}. */
  readonly geometry: THREE.BufferGeometry;
  /**
   * Called once a newer entry is pushed. Drops the message this entry was built from, so a decay
   * history holds only GPU geometry, not one raw message per entry.
   */
  releaseMessage(): void;
};

/** Required caps on a decay history; the decay time alone does not bound a fast or dense topic. */
export type HistoryLimits = {
  maxEntries: number;
  /** Total points drawn across all entries. */
  maxPoints: number;
};

/**
 * ~1000 Hz for 1 s or 10 Hz for 100 s; 10 M points is a few hundred MB of GPU buffers. A point decay
 * ring past these thins evenly, so for it they only set how dense the history can be.
 */
export const DECAY_HISTORY_LIMITS: HistoryLimits = { maxEntries: 1_000, maxPoints: 10_000_000 };

export const DECAY_LIMITED = "DECAY_LIMITED";

/**
 * Tells apart distinct records received at the same time with the same header stamp (e.g. the
 * segments of one sweep published together): a 53-bit hash of the whole payload, about 0.3 ms per
 * MB. Messages carry no record id (offset or sequence). Only computed on a tie of both times.
 */
export function payloadFingerprint(payload: ArrayBufferView): number {
  const bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  let a = Math.imul(0x811c9dc5 ^ bytes.length, 16777619);
  let b = 0x9747b28c ^ bytes.length;
  const wordCount = bytes.length >> 2;
  const mix = (word: number) => {
    a = Math.imul(a ^ word, 16777619);
    b = Math.imul(b ^ word, 0x5bd1e995) ^ (b >>> 15);
  };
  // The same little-endian words whatever the alignment of the view
  if ((bytes.byteOffset & 3) === 0) {
    for (const word of new Uint32Array(bytes.buffer, bytes.byteOffset, wordCount)) {
      mix(word);
    }
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let w = 0; w < wordCount; w++) {
      mix(view.getUint32(w * 4, true));
    }
  }
  for (let i = wordCount * 4; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i]!, 16777619);
    b = Math.imul(b ^ bytes[i]!, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0) * 2 ** 21 + (b >>> 11);
}

/**
 * A scene extension that takes messages read back after a seek straight into its decay history,
 * decoded right away (never through the renderer's message queue) and unsynchronized, since
 * historical scans have nothing to wait for. The drawn scan and anything newer are left to
 * playback, which delivers them through timestamp sync.
 */
export type DecayHistoryIngest = {
  /** Schemas it takes history for */
  readonly historySchemas: ReadonlySet<string>;
  /** Returns the header stamp of a scan it added to the history (to place it), else undefined */
  addHistoricalMessage(messageEvent: MessageEvent): bigint | undefined;
};

export function isDecayHistoryIngest(extension: object): extension is DecayHistoryIngest {
  return "addHistoricalMessage" in extension;
}

/**
 * Shows the notice that the limits shape a decay history (the latest scan alone fills the point
 * budget, scans in the window were dropped for it, or the ring keeps only 1 in N incoming scans), or
 * clears it. Takes and returns the key
 * of the shown notice, so its text is only formatted again when it changes.
 */
export function updateDecayNotice({
  renderer,
  settingsPath,
  ring,
  maxPoints,
  latestPoints,
  windowStart,
  shownKey,
}: {
  renderer: Renderer;
  settingsPath: readonly string[];
  ring: DecayPointRing;
  maxPoints: number;
  latestPoints: number;
  /** Receive time where the decay window starts */
  windowStart: bigint;
  shownKey: string | undefined;
}): string | undefined {
  const errors = renderer.settings.errors;
  const evictedUntil = ring.budgetEvictedUntil();
  const droppedInWindow = evictedUntil != undefined && evictedUntil >= windowStart;
  // No history fits next to the latest scan: it alone fills the budget, or the budget just dropped
  // the last history scan because one more scan its size doesn't fit (not merely an empty ring
  // whose scans expired)
  const noRoom =
    latestPoints >= maxPoints ||
    (ring.scanCount() === 0 && latestPoints * 2 > maxPoints && droppedInWindow);
  const state = noRoom
    ? "threeDee:decayHistoryLimited"
    : droppedInWindow
      ? "threeDee:decayHistoryDropped"
      : ring.stride() > 1
        ? "threeDee:decayHistoryThinned"
        : undefined;
  if (state == undefined) {
    errors.remove(settingsPath, DECAY_LIMITED);
    return undefined;
  }
  const locale = i18next.language;
  const key = `${locale} ${maxPoints} ${state} ${ring.stride()}`;
  // (errors can also be cleared elsewhere, e.g. on a topic reset)
  if (key !== shownKey || !errors.hasError(settingsPath, DECAY_LIMITED)) {
    const values = {
      maxPoints: maxPoints.toLocaleString(locale),
      maxScans: DECAY_HISTORY_LIMITS.maxEntries.toLocaleString(locale),
      stride: ring.stride().toLocaleString(locale),
    };
    errors.add(settingsPath, DECAY_LIMITED, i18next.t(state, values));
  }
  return key;
}

type HistoryEntry<TRenderable extends HistoryRenderable> = {
  receiveTime: bigint;
  messageTime: bigint;
  renderable: TRenderable;
};

/**
 * Class that handles lifecycle of 3d object history over the decay time
 * This class encapsulates the functionality of showing the history of an object within a specified decay time.
 * Meant to be extensible for all kinds of renderables that need to show old points over decay time.
 * See LaserScansRenderable and PointCloudsRenderable for examples.
 */
export class RenderObjectHistory<TRenderable extends HistoryRenderable> {
  #history: HistoryEntry<TRenderable>[];
  #parentRenderable: Renderable<RenderObjectHistoryUserData>;
  #renderer: Renderer;
  readonly #limits: HistoryLimits;

  public constructor({
    initial,
    renderer,
    parentRenderable,
    limits,
  }: {
    initial: HistoryEntry<TRenderable>;
    renderer: Renderer;
    parentRenderable: Renderable<RenderObjectHistoryUserData>;
    limits: HistoryLimits;
  }) {
    this.#history = [initial];
    this.#renderer = renderer;
    this.#parentRenderable = parentRenderable;
    this.#limits = limits;
  }

  public addHistoryEntry(entry: HistoryEntry<TRenderable>): void {
    this.latest().renderable.releaseMessage();
    this.#history.push(entry);
    this.#evictOldest(this.#history.length - this.#limits.maxEntries);
  }

  /** Whether an entry with these times exists for which `same` (checked only on such a tie) holds */
  public has(
    receiveTime: bigint,
    messageTime: bigint,
    same: (renderable: TRenderable) => boolean,
  ): boolean {
    return this.#history.some(
      (entry) =>
        entry.receiveTime === receiveTime &&
        entry.messageTime === messageTime &&
        same(entry.renderable),
    );
  }

  /** Adds an entry older than the latest one (read back after a seek), in time order */
  public insertOlderEntry(entry: HistoryEntry<TRenderable>): void {
    entry.renderable.releaseMessage();
    let at = this.#history.length - 1; // the latest stays last
    while (at > 0 && this.#history[at - 1]!.receiveTime > entry.receiveTime) {
      at--;
    }
    this.#history.splice(at, 0, entry);
    this.#evictOldest(this.#history.length - this.#limits.maxEntries);
    // A read-back window inserts many entries before the next frame trims them: cap it here
    this.#enforcePointBudget();
  }

  /** Disposes the `count` oldest entries, always keeping the latest. */
  #evictOldest(count: number): void {
    if (count <= 0) {
      return;
    }
    const evicted = this.#history.splice(0, Math.min(count, this.#history.length - 1));
    for (const entry of evicted) {
      this.#parentRenderable.remove(entry.renderable);
      entry.renderable.dispose();
    }
  }

  /** Drops the oldest entries until the drawn points fit in {@link HistoryLimits.maxPoints}. */
  #enforcePointBudget(): void {
    let points = 0;
    for (let i = this.#history.length - 1; i >= 0; i--) {
      const count = this.#history[i]!.renderable.geometry.drawRange.count;
      points += Number.isFinite(count) ? count : 0;
      if (points > this.#limits.maxPoints) {
        this.#evictOldest(i + 1);
        return;
      }
    }
  }

  public forEach(callback: (entry: HistoryEntry<TRenderable>) => void): void {
    this.#history.forEach(callback);
  }

  public updateHistoryFromCurrentTime(currentTime: bigint): void {
    // Remove expired entries from the history of points when decayTime is enabled
    const pointsHistory = this.#history;
    const decayTime = this.#parentRenderable.userData.settings.decayTime;
    const expireTime =
      decayTime > 0 ? currentTime - BigInt(Math.round(decayTime * 1e9)) : MAX_DURATION;
    let expired = 0;
    while (expired < pointsHistory.length - 1 && pointsHistory[expired]!.receiveTime < expireTime) {
      expired++;
    }
    this.#evictOldest(expired);
    this.#enforcePointBudget();
  }

  /**
   * Returns whether every entry found its transform. Adds the MISSING_TRANSFORM error when one
   * doesn't; the caller clears it once all histories sharing its settings path resolve.
   */
  public updatePoses(currentTime: bigint, renderFrameId: string, fixedFrameId: string): boolean {
    // Update the pose on each entry
    let hadTfError = false;
    for (const entry of this.#history) {
      const srcTime = entry.messageTime;
      const frameId = this.#parentRenderable.userData.frameId;
      const updated = updatePose(
        entry.renderable,
        this.#renderer.transformTree,
        renderFrameId,
        fixedFrameId,
        frameId,
        currentTime,
        srcTime,
      );
      if (!updated && !hadTfError) {
        const message = missingTransformMessage(
          this.#renderer.transformTree,
          renderFrameId,
          fixedFrameId,
          frameId,
          currentTime,
          srcTime,
        );
        this.#renderer.settings.errors.add(
          this.#parentRenderable.userData.settingsPath,
          MISSING_TRANSFORM,
          message,
        );
        hadTfError = true;
      }
    }
    return !hadTfError;
  }

  public latest(): HistoryEntry<TRenderable> {
    if (this.#history.length === 0) {
      throw new Error("RenderObjectHistory is empty");
    }
    return this.#history[this.#history.length - 1]!;
  }

  /** Removes all but the last renderable, which would be the current object used in rendering. */
  public clearHistory(): void {
    for (const entry of this.#history.splice(0, this.#history.length - 1)) {
      entry.renderable.dispose();
      this.#parentRenderable.remove(entry.renderable);
    }
  }

  public dispose(): void {
    for (const entry of this.#history) {
      entry.renderable.dispose();
    }
    this.#history.length = 0;
  }
}
