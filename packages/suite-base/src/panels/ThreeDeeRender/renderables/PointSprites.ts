// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Discard,
  Fn,
  attribute,
  cameraProjectionMatrix,
  float,
  instanceIndex,
  modelViewMatrix,
  positionGeometry,
  screenDPR,
  screenSize,
  uniform,
  uv,
  vec4,
  vertexStage,
} from "three/tsl";
import * as THREE from "three/webgpu";

import { pickObjectId, pickOutput } from "../Picker";

/**
 * A few points drawn as camera-facing squares or circles, one instanced draw: marker POINTS (sized
 * in meters) and image annotation points (sized in CSS pixels). Big point clouds use the compute
 * point raster instead; these keep ordinary material features (render order, no depth test).
 */
export class PointSprites extends THREE.Mesh<
  THREE.InstancedBufferGeometry,
  THREE.MeshBasicNodeMaterial
> {
  /** Diameter: meters when `worldSize`, else CSS pixels */
  public readonly size = uniform(1);
  #capacity = 0;

  public constructor({
    worldSize,
    circle,
    material: materialProps = {},
  }: {
    worldSize: boolean;
    circle: boolean;
    material?: THREE.MeshBasicNodeMaterialParameters;
  }) {
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.setIndex(quad.index);
    geometry.setAttribute("position", quad.attributes.position!);
    geometry.setAttribute("uv", quad.attributes.uv!);
    geometry.instanceCount = 0;
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, ...materialProps });
    super(geometry, material);
    this.frustumCulled = false;

    const center = vec4(attribute("instancePosition", "vec3"), 1);
    const corner = positionGeometry.xy.mul(this.size);
    if (worldSize) {
      const view = modelViewMatrix.mul(center);
      material.vertexNode = cameraProjectionMatrix.mul(vec4(view.xy.add(corner), view.zw));
    } else {
      const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(center));
      // Device pixels of the render target: the picking target is the one device pixel the pick
      // crops the projection to, so sprites keep their size there too
      const offset = corner.mul(screenDPR.mul(2)).div(screenSize).mul(clip.w);
      material.vertexNode = vec4(clip.xy.add(offset), clip.zw);
    }
    const color = attribute("instanceColor", "vec4");
    material.colorNode = circle
      ? Fn(() => {
          Discard(uv().sub(0.5).length().greaterThan(0.5));
          return color;
        })()
      : color;
    // Picks report the instance and its center's depth (the default pick output would use the
    // unit quad's position, not where the sprite is drawn)
    const pick = material.clone();
    pick.transparent = false;
    pick.blending = THREE.NoBlending;
    pick.depthWrite = true;
    pick.outputNode = pickOutput(
      pickObjectId,
      vertexStage(instanceIndex),
      vertexStage(float(modelViewMatrix.mul(center).z)).negate(),
    );
    this.userData.pickingMaterial = pick;
    this.setPoints(new Float32Array(0), new Uint8Array(0), 0);
  }

  public setPoints(positions: Float32Array, colors: Uint8Array, count: number): void {
    const geometry = this.geometry;
    if (count > this.#capacity || this.#capacity === 0) {
      this.#capacity = Math.max(1, count, Math.ceil(this.#capacity * 1.5));
      geometry.setAttribute(
        "instancePosition",
        new THREE.InstancedBufferAttribute(new Float32Array(this.#capacity * 3), 3),
      );
      geometry.setAttribute(
        "instanceColor",
        new THREE.InstancedBufferAttribute(new Uint8Array(this.#capacity * 4), 4, true),
      );
    }
    const position = geometry.getAttribute("instancePosition") as THREE.InstancedBufferAttribute;
    const color = geometry.getAttribute("instanceColor") as THREE.InstancedBufferAttribute;
    (position.array as Float32Array).set(positions.subarray(0, count * 3));
    (color.array as Uint8Array).set(colors.subarray(0, count * 4));
    position.needsUpdate = true;
    color.needsUpdate = true;
    geometry.instanceCount = count;
  }

  public override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    (this.userData.pickingMaterial as THREE.Material).dispose();
  }
}
