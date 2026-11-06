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

function writeStripSegments(segments: Float32Array, points: Float32Array): void {
  for (let i = 0, j = 0; j < segments.length; i += 3, j += 6) {
    segments[j + 0] = points[i + 0]!;
    segments[j + 1] = points[i + 1]!;
    segments[j + 2] = points[i + 2]!;
    segments[j + 3] = points[i + 3]!;
    segments[j + 4] = points[i + 4]!;
    segments[j + 5] = points[i + 5]!;
  }
}
