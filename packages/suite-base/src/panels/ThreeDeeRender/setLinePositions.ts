// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

/**
 * Same result as `geometry.setPositions(positions)`, but reuses the geometry's GPU buffer when the
 * size is unchanged. `setPositions()` wraps the data in a new buffer on every call, so each update
 * allocates a new GL buffer (and, for a `LineGeometry`, a new segments array) and leaves the old one
 * to the garbage collector.
 */
export function setLinePositions(geometry: LineSegmentsGeometry, positions: Float32Array): void {
  // A LineGeometry draws a strip: segment i runs from point i to point i + 1
  const isStrip = geometry instanceof LineGeometry;
  const length = isStrip ? Math.max(positions.length - 3, 0) * 2 : positions.length;
  const start = geometry.getAttribute("instanceStart");
  const current =
    start instanceof THREE.InterleavedBufferAttribute
      ? (start.data.array as Float32Array)
      : undefined;

  if (current?.length !== length) {
    let segments = positions;
    if (isStrip) {
      segments = new Float32Array(length);
      writeStripSegments(segments, positions);
    }
    LineSegmentsGeometry.prototype.setPositions.call(geometry, segments);
    return;
  }

  if (isStrip) {
    writeStripSegments(current, positions);
  } else if (current !== positions) {
    current.set(positions);
  }
  (start as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
  geometry.instanceCount = length / 6;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/**
 * Per-point RGBA colors (`Uint8Array` is read normalized) as the `instanceColorStart`/`End`
 * attributes, in the same pair layout as the positions. Reuses the GPU buffer when the size is
 * unchanged.
 */
export function setLineColors(
  geometry: LineSegmentsGeometry,
  colors: Float32Array | Uint8Array,
): void {
  const isStrip = geometry instanceof LineGeometry;
  const length = isStrip ? Math.max(colors.length - 4, 0) * 2 : colors.length;
  const start = geometry.getAttribute("instanceColorStart");
  let current =
    start instanceof THREE.InterleavedBufferAttribute
      ? (start.data.array as Float32Array | Uint8Array)
      : undefined;

  if (current?.length !== length || current.constructor !== colors.constructor) {
    current = isStrip ? new (colors.constructor as Uint8ArrayConstructor)(length) : colors;
    const normalized = current instanceof Uint8Array;
    const buffer = new THREE.InstancedInterleavedBuffer(current, 8, 1);
    geometry.setAttribute(
      "instanceColorStart",
      new THREE.InterleavedBufferAttribute(buffer, 4, 0, normalized),
    );
    geometry.setAttribute(
      "instanceColorEnd",
      new THREE.InterleavedBufferAttribute(buffer, 4, 4, normalized),
    );
  } else {
    (start as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
  }

  if (isStrip) {
    writeStripSegments(current, colors, 4);
  } else if (current !== colors) {
    current.set(colors);
  }
}

/** Expands a strip of points with `size` components into start/end pairs */
function writeStripSegments(
  segments: Float32Array | Uint8Array,
  points: Float32Array | Uint8Array,
  size = 3,
): void {
  for (let i = 0, j = 0; j < segments.length; i += size, j += 2 * size) {
    for (let k = 0; k < 2 * size; k++) {
      segments[j + k] = points[i + k]!;
    }
  }
}
