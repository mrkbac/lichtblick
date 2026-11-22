// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AVLTree } from "@foxglove/avl";
import {
  Time,
  fromNanoSec,
  toNanoSec,
  compare as compareTime,
  isLessThan,
} from "@foxglove/rostime";
import {
  CompressedImage,
  RawImage,
  ImageAnnotations as FoxgloveImageAnnotations,
} from "@foxglove/schemas";

import { Immutable, MessageEvent } from "@lichtblick/suite";
import {
  HUDItem,
  HUDItemManager,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/HUDItemManager";
import { ImageModeConfig } from "@lichtblick/suite-base/panels/ThreeDeeRender/IRenderer";
import {
  AnyImage,
  CompressedVideo,
  getTimestampFromImage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/ImageTypes";
import {
  normalizeCompressedImage,
  normalizeCompressedVideo,
  normalizeRawImage,
  normalizeRosCompressedImage,
  normalizeRosImage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/Images/imageNormalizers";
import { normalizeCameraInfo } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/projections";
import {
  ImageMarker as RosImageMarker,
  ImageMarkerArray as RosImageMarkerArray,
} from "@lichtblick/suite-base/types/Messages";

import { normalizeAnnotations } from "./annotations/normalizeAnnotations";
import { Annotation } from "./annotations/types";
import {
  IMAGE_MODE_HUD_GROUP_ID,
  WAITING_FOR_BOTH_MESSAGES_HUD_ID,
  WAITING_FOR_CALIBRATION_HUD_ID,
  WAITING_FOR_IMAGES_NOTICE_ID,
  WAITING_FOR_IMAGES_EMPTY_HUD_ID,
  WAITING_FOR_SYNC_NOTICE_HUD_ID,
  WAITING_FOR_SYNC_EMPTY_HUD_ID,
} from "./constants";
import { PartialMessageEvent } from "../../SceneExtension";
import { SYNC_WINDOW_NS } from "../../TimestampSynchronizer";
import { CompressedImage as RosCompressedImage, Image as RosImage, CameraInfo } from "../../ros";
import { t3D } from "../../t3D";

type NormalizedAnnotations = {
  // required for setting the original message on the renderable
  originalMessage: MessageEvent<RosImageMarkerArray | RosImageMarker | FoxgloveImageAnnotations>;
  annotations: Annotation[];
  /** In the sync tree: this stamp's share of the message size */
  bytes?: number;
};

type SynchronizationItem = {
  image?: Readonly<MessageEvent<AnyImage>>;
  annotationsByTopic: Map<string, NormalizedAnnotations>;
};

type Config = Pick<
  ImageModeConfig,
  "synchronize" | "annotations" | "calibrationTopic" | "imageTopic"
>;

type MessageHandlerState = {
  image?: MessageEvent<AnyImage>;
  cameraInfo?: CameraInfo;
  annotationsByTopic: Map<string, NormalizedAnnotations>;

  /** Topics that were present in a potential synchronized set */
  presentAnnotationTopics?: string[];
  /** Topics that were missing so that a synchronized set could not be found */
  missingAnnotationTopics?: string[];
};

export type MessageRenderState = Readonly<Partial<MessageHandlerState>>;

type RenderStateListener = (
  newState: MessageRenderState,
  oldState: MessageRenderState | undefined,
) => void;

// Have constants for the HUD items so that they don't need to be recreated and GCed every message
export const WAITING_FOR_BOTH_HUD_ITEM: HUDItem = {
  id: WAITING_FOR_BOTH_MESSAGES_HUD_ID,
  group: IMAGE_MODE_HUD_GROUP_ID,
  getMessage: () => t3D("waitingForCalibrationAndImages"),
  displayType: "empty",
};

export const WAITING_FOR_CALIBRATION_HUD_ITEM: HUDItem = {
  id: WAITING_FOR_CALIBRATION_HUD_ID,
  group: IMAGE_MODE_HUD_GROUP_ID,
  getMessage: () => t3D("waitingForCalibration"),
  displayType: "empty",
};

export const WAITING_FOR_IMAGE_NOTICE_HUD_ITEM: HUDItem = {
  id: WAITING_FOR_IMAGES_NOTICE_ID,
  group: IMAGE_MODE_HUD_GROUP_ID,
  getMessage: () => t3D("waitingForImages"),
  displayType: "notice",
};

export const WAITING_FOR_IMAGE_EMPTY_HUD_ITEM: HUDItem = {
  id: WAITING_FOR_IMAGES_EMPTY_HUD_ID,
  group: IMAGE_MODE_HUD_GROUP_ID,
  getMessage: () => t3D("waitingForImages"),
  displayType: "empty",
};

export const WAITING_FOR_SYNC_NOTICE_HUD_ITEM: HUDItem = {
  id: WAITING_FOR_SYNC_NOTICE_HUD_ID,
  group: IMAGE_MODE_HUD_GROUP_ID,
  getMessage: () => t3D("waitingForSyncAnnotations"),
  displayType: "notice",
};

export const WAITING_FOR_SYNC_EMPTY_HUD_ITEM: HUDItem = {
  id: WAITING_FOR_SYNC_EMPTY_HUD_ID,
  group: IMAGE_MODE_HUD_GROUP_ID,
  getMessage: () => t3D("waitingForSyncAnnotations"),
  displayType: "empty",
};
/**
 * Processes and normalizes incoming messages and manages state of
 * messages to be rendered given the ImageMode config. A large part of this responsibility
 * is managing state in synchronized mode and ensuring that the a synchronized set of image and
 * annotations are handed off to the SceneExtension for rendering.
 */
/**
 * Image and annotation bytes buffered while waiting for a synchronized set; the oldest stamps go
 * first past it. Together with {@link SYNC_WINDOW_NS} (annotations later than that are treated
 * as never arriving) it bounds memory when an annotation topic stalls.
 */
export const SYNC_BYTES = 256 * 1024 * 1024;

export class MessageHandler {
  /** settings that should reflect image mode config */
  #config: Immutable<Config>;

  /** Allows message handler push messages to overlay on top of the canvas */
  #hud: HUDItemManager;

  /** last state passed to listeners */
  #oldRenderState: MessageRenderState | undefined;

  /** internal state of last received messages */
  #lastReceivedMessages: MessageHandlerState;

  /** sorted tree that holds state for synchronized messages. Used to find most recent synchronized set of image and annotations. */
  readonly #tree: AVLTree<Time, SynchronizationItem>;

  /** Total {@link itemBytes} of `#tree` */
  #treeBytes = 0;

  /** Stamp of the synchronized set being shown; everything older is dropped from `#tree` */
  #match: Time | undefined;
  /**
   * Stamps changed since the last render state. A new set can only complete at one of them, so the
   * whole tree is only searched again (`#rescan`) when the config or available topics change.
   */
  #touched: Time[] = [];
  #rescan = true;

  /** listener functions that are called when the state changes. */
  #listeners: RenderStateListener[] = [];

  /** Holds what annotations are currently available on the given source. These are needed because annotations
   * that are marked as visible may be present in the layout/config, but are not present on the source.
   * This can cause synchronized annotations to never resolve if the source does not have the annotation topic
   * with no indication to the user that the annotation is not available.
   */
  #availableAnnotationTopics: Set<string>;

  /**
   *
   * @param config - subset of ImageMode settings required for message handling
   */
  public constructor(config: Immutable<Config>, hud: HUDItemManager) {
    this.#config = config;
    this.#hud = hud;
    this.#lastReceivedMessages = {
      annotationsByTopic: new Map(),
    };
    this.#tree = new AVLTree<Time, SynchronizationItem>(compareTime);
    this.#availableAnnotationTopics = new Set();
  }

  public addListener(listener: RenderStateListener): void {
    this.#listeners.push(listener);
  }

  public removeListener(listener: RenderStateListener): void {
    this.#listeners = this.#listeners.filter((fn) => fn !== listener);
  }

  public handleRosRawImage = (messageEvent: PartialMessageEvent<RosImage>): void => {
    this.handleImage(messageEvent, normalizeRosImage(messageEvent.message));
  };

  public handleRosCompressedImage = (
    messageEvent: PartialMessageEvent<RosCompressedImage>,
  ): void => {
    this.handleImage(messageEvent, normalizeRosCompressedImage(messageEvent.message));
  };

  public handleRawImage = (messageEvent: PartialMessageEvent<RawImage>): void => {
    this.handleImage(messageEvent, normalizeRawImage(messageEvent.message));
  };

  public handleCompressedImage = (messageEvent: PartialMessageEvent<CompressedImage>): void => {
    this.handleImage(messageEvent, normalizeCompressedImage(messageEvent.message));
  };
  public handleCompressedVideo = (messageEvent: PartialMessageEvent<CompressedVideo>): void => {
    this.handleImage(messageEvent, normalizeCompressedVideo(messageEvent.message));
  };

  protected handleImage(message: PartialMessageEvent<AnyImage>, image: AnyImage): void {
    const normalizedImageMessage: MessageEvent<AnyImage> = {
      ...message,
      message: image,
    };

    this.#lastReceivedMessages.image = normalizedImageMessage;
    if (this.#config.synchronize !== true) {
      this.#emitState();
      return;
    }
    // Update the image at the stamp time
    this.#addImageToTree(normalizedImageMessage);
    this.#emitState();
  }

  #addImageToTree(normalizedImageMessage: MessageEvent<AnyImage>) {
    const image = normalizedImageMessage.message;
    const stamp = getTimestampFromImage(image);
    const item = this.#tree.get(stamp);
    if (item) {
      this.#treeBytes -= imageBytes(item.image);
      item.image = normalizedImageMessage;
    } else {
      this.#tree.set(stamp, { image: normalizedImageMessage, annotationsByTopic: new Map() });
    }
    this.#treeBytes += imageBytes(normalizedImageMessage);
    this.#touched.push(stamp);
  }

  /**
   * Drops stamps more than SYNC_WINDOW_NS behind `latest` (the newest stamp received just now, not
   * the tree's max, so one future-stamped message can't evict everything after it) and the oldest
   * ones past SYNC_BYTES, so sets that never complete cannot pile up. The newest stays. Runs after
   * matching, so a set completed by the same message that would evict it is still shown.
   */
  #evictOldSyncItems(latest: Time | undefined): void {
    const cutoff = latest ? toNanoSec(latest) - SYNC_WINDOW_NS : undefined;
    while (
      this.#tree.size > 1 &&
      ((cutoff != undefined && toNanoSec(this.#tree.minKey()!) < cutoff) ||
        this.#treeBytes > SYNC_BYTES)
    ) {
      this.#shiftSyncItem();
    }
  }

  #shiftSyncItem(): void {
    this.#treeBytes -= itemBytes(this.#tree.shift()?.[1]);
  }

  #clearSyncItems(): void {
    this.#tree.clear();
    this.#treeBytes = 0;
    this.#rescan = true;
  }

  public handleCameraInfo = (message: PartialMessageEvent<CameraInfo>): void => {
    const cameraInfo = normalizeCameraInfo(message.message);
    this.#lastReceivedMessages.cameraInfo = cameraInfo;
    this.#emitState();
  };

  public handleAnnotations = (
    messageEvent: MessageEvent<FoxgloveImageAnnotations | RosImageMarker | RosImageMarkerArray>,
  ): void => {
    const annotations = normalizeAnnotations(messageEvent.message, messageEvent.schemaName);

    const { topic } = messageEvent;
    if (this.#config.synchronize !== true) {
      this.#lastReceivedMessages.annotationsByTopic.set(topic, {
        originalMessage: messageEvent,
        annotations,
      });
      this.#emitState();
      return;
    }
    const groups = new Map<bigint, Annotation[]>();

    for (const annotation of annotations) {
      const key = toNanoSec(annotation.stamp);
      const arr = groups.get(key);
      if (arr) {
        arr.push(annotation);
        continue;
      }
      groups.set(key, [annotation]);
    }

    for (const [stampNsec, group] of groups) {
      const stamp = fromNanoSec(stampNsec);
      let item = this.#tree.get(stamp);
      if (!item) {
        item = {
          image: undefined,
          annotationsByTopic: new Map(),
        };
        this.#tree.set(stamp, item);
      }
      const bytes = Math.ceil(messageEvent.sizeInBytes / groups.size);
      this.#treeBytes += bytes - (item.annotationsByTopic.get(topic)?.bytes ?? 0);
      item.annotationsByTopic.set(topic, {
        originalMessage: messageEvent,
        annotations: group,
        bytes,
      });
      this.#touched.push(stamp);
    }

    this.#emitState();
  };

  public setConfig(newConfig: Immutable<ImageModeConfig>): void {
    let changed = false;
    this.#rescan = true;

    if (newConfig.synchronize != undefined && newConfig.synchronize !== this.#config.synchronize) {
      this.#oldRenderState = undefined;
      this.#clearSyncItems();
      if (newConfig.synchronize && this.#lastReceivedMessages.image != undefined) {
        this.#addImageToTree(this.#lastReceivedMessages.image);
      }

      changed = true;
    }

    if ("imageTopic" in newConfig && this.#config.imageTopic !== newConfig.imageTopic) {
      for (const item of this.#tree.values()) {
        this.#treeBytes -= imageBytes(item.image);
        item.image = undefined;
      }
      this.#lastReceivedMessages.image = undefined;
      changed = true;
    }

    if (this.#config.calibrationTopic !== newConfig.calibrationTopic) {
      this.#lastReceivedMessages.cameraInfo = undefined;
      changed = true;
    }

    if (
      newConfig.annotations != undefined &&
      this.#config.annotations &&
      this.#config.annotations !== newConfig.annotations
    ) {
      const newVisibleTopics = new Set<string>();

      for (const [topic, settings] of Object.entries(newConfig.annotations)) {
        if (settings?.visible === true) {
          newVisibleTopics.add(topic);
        }
      }

      for (const topic of this.#lastReceivedMessages.annotationsByTopic.keys()) {
        if (!newVisibleTopics.has(topic)) {
          this.#lastReceivedMessages.annotationsByTopic.delete(topic);
          changed = true;
        }
      }
      for (const syncEntry of this.#tree.values()) {
        for (const topic of syncEntry.annotationsByTopic.keys()) {
          if (!newVisibleTopics.has(topic)) {
            this.#treeBytes -= syncEntry.annotationsByTopic.get(topic)?.bytes ?? 0;
            syncEntry.annotationsByTopic.delete(topic);
            changed = true;
          }
        }
      }
    }

    this.#config = newConfig;

    if (changed) {
      this.#emitState();
    }
  }

  public setAvailableAnnotationTopics(topicNames: string[]): void {
    this.#availableAnnotationTopics = new Set(topicNames);
    this.#rescan = true;
    this.#emitState();
  }

  public clear(): void {
    this.#lastReceivedMessages = {
      annotationsByTopic: new Map(),
    };
    this.#clearSyncItems();
    this.#oldRenderState = undefined;
    this.#emitState();
  }

  #emitState() {
    const state = this.getRenderStateAndUpdateHUD();

    this.#listeners.forEach((fn) => {
      fn(state, this.#oldRenderState);
    });
    this.#oldRenderState = state;
  }

  /** Do not use. only public for testing */
  public getRenderStateAndUpdateHUD(): Readonly<Partial<MessageHandlerState>> {
    const state = this.#getRenderState();
    this.#updateHUDFromState(state);
    return state;
  }

  #updateHUDFromState(state: MessageRenderState): void {
    const calibrationRequired = this.#config.calibrationTopic != undefined;

    const waitingForImage =
      this.#lastReceivedMessages.image == undefined && state.image == undefined;

    const waitingForCalibration = calibrationRequired && state.cameraInfo == undefined;

    const waitingForBoth = waitingForImage && waitingForCalibration;

    this.#hud.displayIfTrue(waitingForBoth, WAITING_FOR_BOTH_HUD_ITEM);

    // don't show other empty states when waiting for both to reduce noise
    this.#hud.displayIfTrue(
      waitingForCalibration && !waitingForBoth,
      WAITING_FOR_CALIBRATION_HUD_ITEM,
    );
    this.#hud.displayIfTrue(
      waitingForImage && !calibrationRequired && !waitingForBoth,
      WAITING_FOR_IMAGE_EMPTY_HUD_ITEM,
    );
    this.#hud.displayIfTrue(
      waitingForImage && calibrationRequired,
      WAITING_FOR_IMAGE_NOTICE_HUD_ITEM,
    );

    const waitingForSync =
      !!state.missingAnnotationTopics && state.missingAnnotationTopics.length > 0;
    this.#hud.displayIfTrue(
      waitingForSync && calibrationRequired,
      WAITING_FOR_SYNC_NOTICE_HUD_ITEM,
    );

    // it is an empty state if calibration not required
    this.#hud.displayIfTrue(
      waitingForSync && !calibrationRequired,
      WAITING_FOR_SYNC_EMPTY_HUD_ITEM,
    );
  }

  #getRenderState(): Readonly<Partial<MessageHandlerState>> {
    if (this.#config.synchronize === true) {
      const result = this.#findSynchronizedSetAndRemoveOlderItems(this.#visibleAnnotations());
      if (result.found) {
        return {
          cameraInfo: this.#lastReceivedMessages.cameraInfo,
          image: result.messages.image,
          annotationsByTopic: result.messages.annotationsByTopic,
        };
      }
      return {
        cameraInfo: this.#lastReceivedMessages.cameraInfo,
        presentAnnotationTopics: result.presentAnnotationTopics,
        missingAnnotationTopics: result.missingAnnotationTopics,
      };
    }
    return { ...this.#lastReceivedMessages };
  }

  /**
   * Finds the newest entry with an image and every visible annotation topic, and removes all older
   * entries. Without one, reports which topics the newest image is missing.
   */
  #findSynchronizedSetAndRemoveOlderItems(visibleAnnotations: Set<string>): SynchronizationResult {
    const visible = [...visibleAnnotations];
    const complete = (item: SynchronizationItem | undefined): item is SynchronizationItem =>
      item?.image != undefined && visible.every((topic) => item.annotationsByTopic.has(topic));

    if (this.#rescan) {
      this.#rescan = false;
      this.#match = undefined;
      // Newest first: stops at the first complete entry
      for (let entry = this.#tree.maxEntry(); entry; entry = this.#tree.findLessThan(entry[0])) {
        if (complete(entry[1])) {
          this.#match = entry[0];
          break;
        }
      }
    } else {
      for (const stamp of this.#touched) {
        if (
          (this.#match == undefined || compareTime(stamp, this.#match) > 0) &&
          complete(this.#tree.get(stamp))
        ) {
          this.#match = stamp;
        }
      }
    }
    let latest: Time | undefined;
    for (const stamp of this.#touched) {
      if (latest == undefined || compareTime(stamp, latest) > 0) {
        latest = stamp;
      }
    }
    this.#touched.length = 0;

    // Captured before eviction, which may drop it: shown for this render only
    const matched = this.#match && this.#tree.get(this.#match);
    if (complete(matched)) {
      while (isLessThan(this.#tree.minKey()!, this.#match!)) {
        this.#shiftSyncItem();
      }
    }
    if (this.#tree.size > 0) {
      this.#evictOldSyncItems(latest);
    }
    if (complete(matched)) {
      return { found: true, messages: matched };
    }
    this.#match = undefined;

    for (let entry = this.#tree.maxEntry(); entry; entry = this.#tree.findLessThan(entry[0])) {
      const { image, annotationsByTopic } = entry[1];
      if (image) {
        const presentAnnotationTopics: string[] = [];
        const missingAnnotationTopics: string[] = [];
        for (const topic of visible) {
          (annotationsByTopic.has(topic) ? presentAnnotationTopics : missingAnnotationTopics).push(
            topic,
          );
        }
        return { found: false, presentAnnotationTopics, missingAnnotationTopics };
      }
    }
    return { found: false, presentAnnotationTopics: undefined, missingAnnotationTopics: undefined };
  }

  #visibleAnnotations(): Set<string> {
    const visibleAnnotations = new Set<string>();
    for (const [topic, settings] of Object.entries(this.#config.annotations ?? {})) {
      if (settings?.visible === true && this.#availableAnnotationTopics.has(topic)) {
        visibleAnnotations.add(topic);
      }
    }
    return visibleAnnotations;
  }
}

type SynchronizationResult =
  | {
      found: true;
      /** Synchronized set of messages found with matching timestamps */
      messages: SynchronizationItem;
    }
  | {
      found: false;
      /**
       * Annotations that were present at the matching timestamp.
       */
      presentAnnotationTopics: string[] | undefined;
      /**
       * Annotations that were missing and caused there to be no synchronized set, or undefined if no
       * images were received at all.
       */
      missingAnnotationTopics: string[] | undefined;
    };

function itemBytes(item: SynchronizationItem | undefined): number {
  let bytes = imageBytes(item?.image);
  for (const annotations of item?.annotationsByTopic.values() ?? []) {
    bytes += annotations.bytes ?? 0;
  }
  return bytes;
}

function imageBytes(image: Readonly<MessageEvent<AnyImage>> | undefined): number {
  return image?.message.data.byteLength ?? 0;
}
