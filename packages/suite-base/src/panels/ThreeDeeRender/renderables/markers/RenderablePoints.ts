// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RenderableMarker } from "./RenderableMarker";
import { markerHasTransparency } from "./materials";
import type { Renderer } from "../../Renderer";
import { Marker } from "../../ros";
import { PointSprites } from "../PointSprites";

/** POINTS marker: squares of scale.x meters facing the camera */
export class RenderablePoints extends RenderableMarker {
  #points = new PointSprites({ worldSize: true, circle: false });
  #positions = new Float32Array(0);
  #colors = new Uint8Array(0);

  public constructor(
    topic: string,
    marker: Marker,
    receiveTime: bigint | undefined,
    renderer: Renderer,
  ) {
    super(topic, marker, receiveTime, renderer);
    this.add(this.#points);
    this.update(marker, receiveTime);
  }

  public override dispose(): void {
    this.#points.dispose();
  }

  public override update(newMarker: Marker, receiveTime: bigint | undefined): void {
    super.update(newMarker, receiveTime);
    const marker = this.userData.marker;
    const material = this.#points.material;
    const transparent = markerHasTransparency(marker);
    if (transparent !== material.transparent) {
      material.transparent = transparent;
      material.depthWrite = !transparent;
      material.needsUpdate = true;
    }
    this.#points.size.value = marker.scale.x;

    const count = marker.points.length;
    if (this.#positions.length < count * 3) {
      this.#positions = new Float32Array(count * 3);
      this.#colors = new Uint8Array(count * 4);
    }
    const positions = this.#positions;
    const colors = this.#colors;
    for (let i = 0; i < count; i++) {
      const point = marker.points[i]!;
      positions[i * 3 + 0] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
    }
    this._markerColorsToLinear(marker, count, (color, i) => {
      colors[4 * i + 0] = (color[0] * 255) | 0;
      colors[4 * i + 1] = (color[1] * 255) | 0;
      colors[4 * i + 2] = (color[2] * 255) | 0;
      colors[4 * i + 3] = (color[3] * 255) | 0;
    });
    this.#points.setPoints(positions, colors, count);
  }
}
