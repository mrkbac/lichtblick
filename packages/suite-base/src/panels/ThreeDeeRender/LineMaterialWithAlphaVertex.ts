// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { attribute, diffuseColor, positionGeometry, varying } from "three/tsl";
import * as THREE from "three/webgpu";

/**
 * `Line2NodeMaterial` with RGBA vertex colors (4-component `instanceColorStart`/`instanceColorEnd`)
 * and regular alpha blending for `transparent` lines. The stock material only reads RGB vertex
 * colors and composites transparent lines over a copy of the opaque scene instead.
 */
export class LineMaterialWithAlphaVertex extends THREE.Line2NodeMaterial {
  public constructor(parameters?: THREE.Line2NodeMaterialParameters) {
    super(parameters);
    // Only blends while `transparent`, like the WebGL renderer's default
    this.blending = parameters?.blending ?? THREE.NormalBlending;
  }

  public override setupDiffuseColor(builder: THREE.NodeBuilder): void {
    const { transparent, vertexColors } = this;
    // Blending already applies a transparent line's alpha; alpha to coverage would apply it again.
    // Set while building, so it follows `transparent` (a change to it rebuilds the material).
    this.alphaToCoverage = !transparent;
    this.transparent = false;
    this.vertexColors = false;
    super.setupDiffuseColor(builder);
    this.transparent = transparent;
    this.vertexColors = vertexColors;

    if (vertexColors && builder.geometry.hasAttribute("instanceColorStart")) {
      // Picked per vertex and interpolated, so colors blend along the segment instead of switching
      // halfway
      const isStart = positionGeometry.y.lessThan(0.5);
      diffuseColor.mulAssign(
        varying(isStart.select(attribute("instanceColorStart"), attribute("instanceColorEnd"))),
      );
    }
  }
}
