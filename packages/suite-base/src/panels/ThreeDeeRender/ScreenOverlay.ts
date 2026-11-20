// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { positionGeometry, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

import type { Renderer } from "./Renderer";

/** A full-screen quad of one color, drawn over everything already rendered */
export class ScreenOverlay extends THREE.Object3D {
  #material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  public constructor(renderer: Renderer) {
    super();
    // The quad spans clip space directly, ignoring the camera
    this.#material.vertexNode = vec4(positionGeometry.xy, 0, 1);

    const geometry = renderer.sharedGeometry.getGeometry(this.constructor.name, createGeometry);
    const mesh = new THREE.Mesh(geometry, this.#material);
    mesh.frustumCulled = false;
    this.add(mesh);
  }

  public setColor(color: THREE.Color, opacity: number): void {
    this.#material.color.copy(color);
    this.#material.opacity = opacity;
  }
}

function createGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(2, 2, 1, 1);
}
