// SPDX-License-Identifier: MPL-2.0

import { isTypedArray } from "@lichtblick/suite-base/types/isTypedArray";

function flatten(item: unknown): unknown[] {
  if (Array.isArray(item)) {
    return item.flatMap(flatten);
  }
  // Binary decoders (CDR, Protobuf, ROS 1) give numeric arrays as typed arrays
  if (isTypedArray(item)) {
    return Array.from<unknown>(item);
  }
  return [item];
}

/**
 * Flattens message path results (numbers, plain/nested arrays, typed arrays) into slice values.
 * Throws when a value isn't numeric, so the panel can say why nothing is drawn.
 */
export function toPieValues(items: readonly unknown[]): Float32Array {
  const values = items.flatMap(flatten).map((item) => Number(item));
  if (values.length === 0) {
    throw new Error("Message path resolved to no values");
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Message path must resolve to numbers or an array of numbers");
  }
  return new Float32Array(values);
}
