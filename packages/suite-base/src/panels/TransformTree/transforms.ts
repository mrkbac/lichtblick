// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, toSec } from "@foxglove/rostime";
import {
  FRAME_TRANSFORMS_DATATYPES,
  FRAME_TRANSFORM_DATATYPES,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/foxglove";
import {
  TF_DATATYPES,
  TRANSFORM_STAMPED_DATATYPES,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";
import { Quaternion, Vector3 } from "@lichtblick/suite-base/util/geometry";

import { TransformSample } from "./types";

export function isTransformSchema(schemaName: string | undefined): boolean {
  return (
    schemaName != undefined &&
    (TF_DATATYPES.has(schemaName) ||
      TRANSFORM_STAMPED_DATATYPES.has(schemaName) ||
      FRAME_TRANSFORM_DATATYPES.has(schemaName) ||
      FRAME_TRANSFORMS_DATATYPES.has(schemaName))
  );
}

/**
 * Default for a topic's "static" setting: by convention static transforms are published on a
 * `tf_static` topic. Users can override it per topic in the panel settings.
 */
export function defaultIsStatic(topic: string): boolean {
  return topic.endsWith("tf_static");
}

type RosTransformStamped = {
  header: { stamp: Time; frame_id: string };
  child_frame_id: string;
  transform: { translation: Vector3; rotation: Quaternion };
};

type FoxgloveFrameTransform = {
  timestamp: Time;
  parent_frame_id: string;
  child_frame_id: string;
  translation: Vector3;
  rotation: Quaternion;
};

// tf2 ignores a leading slash (ROS 1 style frame ids), so we do too.
const normalizeFrameId = (id: string): string => (id.startsWith("/") ? id.slice(1) : id);

function fromRos(msg: RosTransformStamped): TransformSample {
  return {
    parent: normalizeFrameId(msg.header.frame_id),
    child: normalizeFrameId(msg.child_frame_id),
    translation: msg.transform.translation,
    rotation: msg.transform.rotation,
    stamp: toSec(msg.header.stamp),
  };
}

function fromFoxglove(msg: FoxgloveFrameTransform): TransformSample {
  return {
    parent: normalizeFrameId(msg.parent_frame_id),
    child: normalizeFrameId(msg.child_frame_id),
    translation: msg.translation,
    rotation: msg.rotation,
    stamp: toSec(msg.timestamp),
  };
}

/** Extracts every transform from a TF message of any supported schema. */
export function samplesFromMessage(schemaName: string, message: unknown): TransformSample[] {
  if (TF_DATATYPES.has(schemaName)) {
    return (message as { transforms: RosTransformStamped[] }).transforms.map(fromRos);
  }
  if (TRANSFORM_STAMPED_DATATYPES.has(schemaName)) {
    return [fromRos(message as RosTransformStamped)];
  }
  if (FRAME_TRANSFORMS_DATATYPES.has(schemaName)) {
    return (message as { transforms: FoxgloveFrameTransform[] }).transforms.map(fromFoxglove);
  }
  if (FRAME_TRANSFORM_DATATYPES.has(schemaName)) {
    return [fromFoxglove(message as FoxgloveFrameTransform)];
  }
  return [];
}

/** Roll, pitch, yaw in radians (ROS convention: fixed axes X, Y, Z). */
export function quaternionToRpy({ x, y, z, w }: Quaternion): Vector3 {
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { x: roll, y: pitch, z: yaw };
}
