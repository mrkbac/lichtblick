// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three/webgpu";

import { ICameraModel } from "@lichtblick/suite";
import { RosObject, RosValue } from "@lichtblick/suite-base/players/types";

import {
  ANNOTATION_RENDER_ORDER,
  annotationRenderOrderMaterialProps,
} from "./annotationRenderOrder";
import { getAnnotationAtPath } from "./normalizeAnnotations";
import { PointsAnnotation as NormalizedPointsAnnotation } from "./types";
import { BaseUserData, Renderable } from "../../../Renderable";
import { SRGBToLinear } from "../../../color";
import { PointSprites } from "../../PointSprites";

const tempVec3 = new THREE.Vector3();

export class RenderablePointsAnnotation extends Renderable<BaseUserData, /*TRenderer=*/ undefined> {
  #points = new PointSprites({
    worldSize: false,
    circle: false,
    material: annotationRenderOrderMaterialProps,
  });
  #positions = new Float32Array(0);
  #colors = new Uint8Array(0);

  #scale = 0;
  #pixelRatio = 0;
  #scaleNeedsUpdate = false;

  #originalMessage?: RosObject;

  #annotation?: NormalizedPointsAnnotation & { style: "points" };
  #annotationNeedsUpdate = false;

  #cameraModel?: ICameraModel;
  #cameraModelNeedsUpdate = false;

  public constructor(topicName: string) {
    super(topicName, undefined, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "",
      pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 0 } },
      settingsPath: [],
      settings: { visible: true },
      topic: topicName,
    });

    this.#points.renderOrder = ANNOTATION_RENDER_ORDER.POINTS;
    this.add(this.#points);
  }

  public override dispose(): void {
    this.#points.dispose();
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    if (this.#originalMessage && this.#annotation) {
      return {
        annotation: getAnnotationAtPath(this.#originalMessage, this.#annotation.messagePath),
        originalMessage: this.#originalMessage,
      };
    }
    return {};
  }

  public setScale(
    scale: number,
    _canvasWidth: number,
    _canvasHeight: number,
    pixelRatio: number,
  ): void {
    this.#scaleNeedsUpdate ||= scale !== this.#scale || pixelRatio !== this.#pixelRatio;
    this.#scale = scale;
    this.#pixelRatio = pixelRatio;
  }

  public setCameraModel(cameraModel: ICameraModel | undefined): void {
    this.#cameraModelNeedsUpdate ||= this.#cameraModel !== cameraModel;
    this.#cameraModel = cameraModel;
  }

  public setAnnotation(
    annotation: NormalizedPointsAnnotation & { style: "points" },
    originalMessage: RosObject | undefined,
  ): void {
    this.#annotationNeedsUpdate ||= this.#annotation !== annotation;
    this.#originalMessage = originalMessage;
    this.#annotation = annotation;
  }

  public update(): void {
    if (!this.#annotation || !this.#cameraModel) {
      this.visible = false;
      return;
    }
    this.visible = true;

    if (this.#annotationNeedsUpdate || this.#scaleNeedsUpdate) {
      this.#scaleNeedsUpdate = false;
      const { thickness } = this.#annotation;
      // thickness is a radius, the sprite size a diameter; both are uniforms (no shader rebuild)
      this.#points.size.value = thickness * 2 * this.#scale;
      this.#points.pixelRatio.value = this.#pixelRatio;
    }

    if (this.#annotationNeedsUpdate || this.#cameraModelNeedsUpdate) {
      this.#annotationNeedsUpdate = false;
      this.#cameraModelNeedsUpdate = false;
      const { points, outlineColors, outlineColor, fillColor } = this.#annotation;
      if (this.#positions.length < points.length * 3) {
        this.#positions = new Float32Array(points.length * 3);
        this.#colors = new Uint8Array(points.length * 4);
      }
      const positions = this.#positions;
      const colors = this.#colors;
      const fallbackColor = outlineColor && outlineColor.a > 0 ? outlineColor : fillColor;

      for (let i = 0; i < points.length; i++) {
        const color = outlineColors[i] ?? fallbackColor;
        const point = points[i]!;

        this.#cameraModel.projectPixelTo3dPlane(tempVec3, point);

        positions[i * 3 + 0] = tempVec3.x;
        positions[i * 3 + 1] = tempVec3.y;
        positions[i * 3 + 2] = tempVec3.z;
        colors[i * 4 + 0] = SRGBToLinear(color?.r ?? 0) * 255;
        colors[i * 4 + 1] = SRGBToLinear(color?.g ?? 0) * 255;
        colors[i * 4 + 2] = SRGBToLinear(color?.b ?? 0) * 255;
        colors[i * 4 + 3] = (color?.a ?? 0) * 255;
      }
      this.#points.setPoints(positions, colors, points.length);
    }
  }
}
