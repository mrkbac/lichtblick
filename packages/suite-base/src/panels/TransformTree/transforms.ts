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

const isObject = (value: unknown): value is object => typeof value === "object" && value != null;

const isTime = (value: unknown): value is Time =>
  isObject(value) &&
  typeof (value as Partial<Time>).sec === "number" &&
  typeof (value as Partial<Time>).nsec === "number";

/**
 * The sample, or undefined when a field is missing or has the wrong type, e.g. a message sliced
 * to fewer fields or a hand-written JSON recording. One bad transform must not break the panel.
 */
function toSample(
  parent: unknown,
  child: unknown,
  translation: unknown,
  rotation: unknown,
  stamp: unknown,
): TransformSample | undefined {
  if (
    typeof parent !== "string" ||
    typeof child !== "string" ||
    !isObject(translation) ||
    !isObject(rotation) ||
    !isTime(stamp)
  ) {
    return undefined;
  }
  return {
    parent: normalizeFrameId(parent),
    child: normalizeFrameId(child),
    translation: translation as Vector3,
    rotation: rotation as Quaternion,
    stamp: toSec(stamp),
  };
}

// Messages come from recordings and live sources, so no field is trusted to exist.
function fromRos(value: unknown): TransformSample | undefined {
  const msg = value as Partial<RosTransformStamped> | undefined;
  return toSample(
    msg?.header?.frame_id,
    msg?.child_frame_id,
    msg?.transform?.translation,
    msg?.transform?.rotation,
    msg?.header?.stamp,
  );
}

function fromFoxglove(value: unknown): TransformSample | undefined {
  const msg = value as Partial<FoxgloveFrameTransform> | undefined;
  return toSample(
    msg?.parent_frame_id,
    msg?.child_frame_id,
    msg?.translation,
    msg?.rotation,
    msg?.timestamp,
  );
}

/** The `transforms` of a TFMessage or FrameTransforms; a missing array counts as one bad entry. */
function transformsOf(message: unknown): readonly unknown[] {
  const transforms = (message as { transforms?: unknown } | undefined)?.transforms;
  return Array.isArray(transforms) ? transforms : [undefined];
}

/**
 * Extracts every well-formed transform from a TF message of any supported schema. Malformed
 * transforms are skipped, and `onMalformed` is called once for each.
 */
export function samplesFromMessage(
  schemaName: string,
  message: unknown,
  onMalformed?: () => void,
): TransformSample[] {
  let candidates: (TransformSample | undefined)[];
  if (TF_DATATYPES.has(schemaName)) {
    candidates = transformsOf(message).map(fromRos);
  } else if (TRANSFORM_STAMPED_DATATYPES.has(schemaName)) {
    candidates = [fromRos(message)];
  } else if (FRAME_TRANSFORMS_DATATYPES.has(schemaName)) {
    candidates = transformsOf(message).map(fromFoxglove);
  } else if (FRAME_TRANSFORM_DATATYPES.has(schemaName)) {
    candidates = [fromFoxglove(message)];
  } else {
    return [];
  }
  const samples = candidates.filter((sample) => sample != undefined);
  for (let i = samples.length; i < candidates.length; i++) {
    onMalformed?.();
  }
  return samples;
}
