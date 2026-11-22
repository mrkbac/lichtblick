// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  AnyFrameId,
  CoordinateFrame,
  Duration,
  MAX_DURATION,
  Time,
  Transform,
  TransformTree,
} from "../transforms";

const FALLBACK_FRAME_ID = CoordinateFrame.FALLBACK_FRAME_ID;

export const MISSING_TRANSFORM = "MISSING_TRANSFORM";

const name = CoordinateFrame.DisplayName;

/** The message that a pose lookup failed, with the reason when it can be found. */
export function missingTransformMessage(
  tree: TransformTree,
  renderFrameId: AnyFrameId,
  fixedFrameId: AnyFrameId,
  srcFrameId: AnyFrameId,
  dstTime: Time,
  srcTime: Time,
): string {
  const dstFrameId = renderFrameId === srcFrameId ? fixedFrameId : renderFrameId;
  let message;
  if (srcFrameId !== dstFrameId) {
    message = `Missing transform from frame <${name(srcFrameId)}> to frame <${name(dstFrameId)}>`;
  } else if (srcFrameId !== fixedFrameId) {
    message = `Missing transform from frame <${name(srcFrameId)}> to fixed frame <${name(
      fixedFrameId,
    )}> to frame <${name(dstFrameId)}>`;
  } else {
    message = `Identity transform failed for frame <${name(srcFrameId)}>`;
  }
  const reason = explainMissingTransform(
    tree,
    renderFrameId,
    fixedFrameId,
    srcFrameId,
    dstTime,
    srcTime,
  );
  return reason == undefined ? message : `${message}: ${reason}`;
}

type TimeAndTransform = Parameters<CoordinateFrame["findClosestTransforms"]>[0];
const tempLower: TimeAndTransform = [0n, Transform.Identity()];
const tempUpper: TimeAndTransform = [0n, Transform.Identity()];

/**
 * Why `TransformTree.apply` fails, following its two legs: the source frame into the fixed frame at
 * the message time, then the fixed frame into the render frame at the playback time. Names a frame
 * no transform mentions, frames in separate trees, or the first link with no sample in range.
 * Runs only after a lookup failed.
 */
export function explainMissingTransform(
  tree: TransformTree,
  renderFrameId: AnyFrameId,
  fixedFrameId: AnyFrameId,
  srcFrameId: AnyFrameId,
  dstTime: Time,
  srcTime: Time,
  maxDelta: Duration = MAX_DURATION,
): string | undefined {
  const ids: AnyFrameId[] = [srcFrameId, fixedFrameId, renderFrameId];
  for (const id of ids) {
    if (!tree.hasFrame(id)) {
      return `no transform mentions frame <${name(id)}>`;
    }
  }
  return (
    explainLeg(tree, srcFrameId, fixedFrameId, srcTime, "message time", maxDelta) ??
    explainLeg(tree, fixedFrameId, renderFrameId, dstTime, "playback time", maxDelta)
  );
}

function explainLeg(
  tree: TransformTree,
  fromId: AnyFrameId,
  toId: AnyFrameId,
  time: Time,
  timeLabel: string,
  maxDelta: Duration,
): string | undefined {
  const from = tree.frame(fromId);
  const to = tree.frame(toId);
  if (!from || !to || from === to || from.id === FALLBACK_FRAME_ID || to.id === FALLBACK_FRAME_ID) {
    return undefined;
  }
  // Like CoordinateFrame.applyLocal: both frames walk up to their closest common ancestor
  const toChain = new Set<CoordinateFrame<AnyFrameId>>();
  for (let frame: CoordinateFrame<AnyFrameId> | undefined = to; frame; frame = frame.parent()) {
    toChain.add(frame);
  }
  let ancestor: CoordinateFrame<AnyFrameId> | undefined = from;
  while (ancestor && !toChain.has(ancestor)) {
    ancestor = ancestor.parent();
  }
  if (!ancestor) {
    return `<${from.displayName()}> and <${to.displayName()}> are in separate trees (roots <${from.root().displayName()}> and <${to.root().displayName()}>) that no transform connects`;
  }
  for (const start of [from, to]) {
    for (let frame = start; frame !== ancestor; ) {
      const parent = frame.parent()!;
      if (!frame.findClosestTransforms(tempLower, tempUpper, time, maxDelta)) {
        return `no transform from <${frame.displayName()}> to <${parent.displayName()}> near the ${timeLabel}`;
      }
      frame = parent;
    }
  }
  return undefined;
}
