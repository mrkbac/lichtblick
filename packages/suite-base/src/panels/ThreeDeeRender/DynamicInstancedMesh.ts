// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { ColorRGBA, Vector3 } from "./ros";

const INITIAL_CAPACITY = 4;

const tempMat4 = new THREE.Matrix4();

/**
 * Extends InstancedMesh with a set() method that takes a list of points and
 * colors and dynamically resizes the buffer attributes.
 */
export class DynamicInstancedMesh<
  TGeometry extends THREE.BufferGeometry = THREE.BufferGeometry,
  TMaterial extends THREE.Material | THREE.Material[] = THREE.Material | THREE.Material[],
> extends THREE.InstancedMesh<TGeometry, TMaterial> {
  // Total size of the buffer attributes, which can be larger than .count (instances in use)
  #capacity: number;

  public constructor(geometry: TGeometry, material: TMaterial, initialCapacity = INITIAL_CAPACITY) {
    super(geometry, material, 0);

    this.#capacity = initialCapacity;
    this.frustumCulled = false;
    this.#resize();
  }

  public set(
    points: Vector3[],
    scale: Vector3,
    colors: ColorRGBA[],
    defaultColor: ColorRGBA,
  ): void {
    const count = points.length;
    this.#setCount(count);

    const colorArray = this.instanceColor!.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const point = points[i]!;
      const color = colors[i] ?? defaultColor;

      tempMat4.makeTranslation(point.x, point.y, point.z);
      tempMat4.scale(scale as THREE.Vector3);
      this.setMatrixAt(i, tempMat4);

      colorArray[i * 3 + 0] = color.r;
      colorArray[i * 3 + 1] = color.g;
      colorArray[i * 3 + 2] = color.b;
    }
    this.instanceMatrix.needsUpdate = true;
    if (this.instanceColor) {
      this.instanceColor.needsUpdate = true;
    }
  }

  #setCount(count: number) {
    while (count >= this.#capacity) {
      this.#expand();
    }
    this.count = count;
  }

  #expand() {
    this.#capacity = this.#capacity + Math.trunc(this.#capacity / 2) + 16;
    this.#resize();
  }

  #resize() {
    const oldMatrixArray = this.instanceMatrix.array as Float32Array;
    const oldColorArray = this.instanceColor?.array as Float32Array | undefined;

    const newMatrixArray = new Float32Array(this.#capacity * 16);
    // Floats: WebGPU has no 3-component 8-bit vertex format
    const newColorArray = new Float32Array(this.#capacity * 3);

    if (oldMatrixArray.length > 0) {
      newMatrixArray.set(oldMatrixArray);
    }
    if (oldColorArray && oldColorArray.length > 0) {
      newColorArray.set(oldColorArray);
    }

    this.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
    this.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);

    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
}
