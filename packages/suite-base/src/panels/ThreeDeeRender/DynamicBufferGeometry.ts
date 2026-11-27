// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { MAX_SET_POINTS } from "./renderables/pointClouds/PointRaster";

/** Regrowth headroom, so a slowly growing count doesn't reallocate on every new maximum */
const GROWTH = 1.5;
/** Shrink once the count uses less than 1/SHRINK_BELOW of the capacity (hysteresis vs. GROWTH) */
const SHRINK_BELOW = 4;
/** Capacities below this many items are never shrunk; not worth a reallocation */
const MIN_SHRINK_CAPACITY = 65_536;

type TypedArrayConstructor<T extends THREE.TypedArray> = new (length: number) => T;

export class DynamicBufferGeometry extends THREE.BufferGeometry {
  public override attributes: { [name: string]: THREE.BufferAttribute } = {};

  #attributeConstructors = new Map<string, TypedArrayConstructor<THREE.TypedArray>>();
  #usage: THREE.Usage;
  #itemCapacity = 0;

  public constructor(usage: THREE.Usage = THREE.DynamicDrawUsage) {
    super();
    this.#usage = usage;
  }

  public setUsage(usage: THREE.Usage): void {
    this.#usage = usage;
    for (const attribute of Object.values(this.attributes)) {
      attribute.setUsage(usage);
    }
  }

  public createAttribute<T extends THREE.TypedArray, C extends TypedArrayConstructor<T>>(
    name: string,
    arrayConstructor: C,
    itemSize: number,
    // eslint-disable-next-line @lichtblick/no-boolean-parameters
    normalized?: boolean,
  ): THREE.BufferGeometry {
    const data = new arrayConstructor(this.#itemCapacity * itemSize);
    const attribute = new THREE.BufferAttribute(data, itemSize, normalized);
    attribute.setUsage(this.#usage);
    this.#attributeConstructors.set(name, arrayConstructor);
    return this.setAttribute(name, attribute);
  }

  /**
   * Sets the draw range to `itemCount`, reallocating (without keeping the contents) when it doesn't
   * fit or uses a small share of a large capacity. The first allocation is exact, since most
   * geometries are filled once; regrowth adds headroom.
   */
  public resize(itemCount: number): void {
    this.setDrawRange(0, itemCount);

    const capacity = this.#itemCapacity;
    let newCapacity: number;
    if (itemCount > capacity) {
      // Headroom never pushes a point set past what the point raster can address
      newCapacity =
        capacity === 0
          ? itemCount
          : Math.max(itemCount, Math.min(Math.ceil(capacity * GROWTH), MAX_SET_POINTS));
    } else if (capacity > MIN_SHRINK_CAPACITY && itemCount * SHRINK_BELOW < capacity) {
      newCapacity = Math.ceil(itemCount * GROWTH);
    } else {
      return;
    }

    for (const [attributeName, attribute] of Object.entries(this.attributes)) {
      const dataConstructor = this.#attributeConstructors.get(attributeName);
      if (!dataConstructor) {
        throw new Error(
          `DynamicBufferGeometry resize(${itemCount}) failed, missing data constructor for attribute "${attributeName}". Attributes must be created using createAttribute().`,
        );
      }
      const data = new dataConstructor(newCapacity * attribute.itemSize);
      const newAttrib = new THREE.BufferAttribute(data, attribute.itemSize, attribute.normalized);
      newAttrib.setUsage(this.#usage);
      this.setAttribute(attributeName, newAttrib);
    }

    this.#itemCapacity = newCapacity;
  }
}
