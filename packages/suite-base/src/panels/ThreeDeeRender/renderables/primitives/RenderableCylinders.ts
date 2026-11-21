// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import { CylinderPrimitive, SceneEntity } from "@foxglove/schemas";
import { attribute, mat4, mix, positionGeometry, positionLocal, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

import { RenderablePrimitive } from "./RenderablePrimitive";
import type { Renderer } from "../../Renderer";
import { DARK_OUTLINE, LIGHT_OUTLINE, makeRgba, rgbToThreeColor, stringToRgba } from "../../color";
import { LayerSettingsEntity } from "../../settings";
import { MeshStandardMaterialWithInstanceOpacity } from "../materials/MeshStandardMaterialWithInstanceOpacity";

const tempColor = new THREE.Color();
const tempVec3 = new THREE.Vector3();
const tempVec3_2 = new THREE.Vector3();
const tempMat4 = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();
const tempRgba = makeRgba();

export class RenderableCylinders extends RenderablePrimitive {
  // Each RenderableCylinders needs its own geometry because we attach additional custom attributes to it.
  #mesh: THREE.InstancedMesh<THREE.CylinderGeometry, MeshStandardMaterialWithInstanceOpacity>;
  #geometry: THREE.CylinderGeometry;
  // actual shared geometry across instances, only copy -- do not modify
  // stored for ease of use
  #sharedEdgesGeometry: THREE.EdgesGeometry;
  #instanceOpacity: THREE.InstancedBufferAttribute;
  #instanceTopScale: THREE.InstancedBufferAttribute;
  #instanceBottomScale: THREE.InstancedBufferAttribute;
  #outlineMaterial = new CylinderOutlineMaterial();
  #material = new CylinderMaterial();

  /**
   * The initial count passed to `mesh`'s constructor, i.e. the maximum number of instances it can
   * render before we need to create a new mesh object
   */
  #maxInstances: number;

  #outlineGeometry: THREE.InstancedBufferGeometry;
  #outlineMatrices: THREE.InstancedInterleavedBuffer;
  #outline: THREE.LineSegments;

  public constructor(renderer: Renderer) {
    super("", renderer);

    this.#geometry = renderer.sharedGeometry
      .getGeometry(`${this.constructor.name}-cylinder`, createGeometry)
      .clone();
    this.#maxInstances = 16;
    this.#mesh = new THREE.InstancedMesh(this.#geometry, this.#material, this.#maxInstances);
    this.#mesh.frustumCulled = false;
    this.#instanceOpacity = new THREE.InstancedBufferAttribute(
      new Float32Array(this.#maxInstances),
      1,
    );
    this.#instanceBottomScale = new THREE.InstancedBufferAttribute(
      new Float32Array(this.#maxInstances),
      1,
    );
    this.#instanceTopScale = new THREE.InstancedBufferAttribute(
      new Float32Array(this.#maxInstances),
      1,
    );
    this.#geometry.setAttribute("instanceOpacity", this.#instanceOpacity);
    this.#geometry.setAttribute("instanceBottomScale", this.#instanceBottomScale);
    this.#geometry.setAttribute("instanceTopScale", this.#instanceTopScale);
    this.#mesh.count = 0;
    this.add(this.#mesh);

    this.#sharedEdgesGeometry = renderer.sharedGeometry.getGeometry(
      `${this.constructor.name}-edges`,
      () => createEdgesGeometry(this.#geometry),
    );
    this.#outlineGeometry = new THREE.InstancedBufferGeometry();
    (this.#outlineGeometry as THREE.BufferGeometry).copy(this.#sharedEdgesGeometry);
    this.#outlineMatrices = shareInstanceMatrix(this.#outlineGeometry, this.#mesh.instanceMatrix);
    this.#outlineGeometry.setAttribute("instanceBottomScale", this.#instanceBottomScale);
    this.#outlineGeometry.setAttribute("instanceTopScale", this.#instanceTopScale);
    this.#outline = new THREE.LineSegments(this.#outlineGeometry, this.#outlineMaterial);
    this.#outline.frustumCulled = false;
    this.#outline.userData.picking = false;
    this.add(this.#outline);
  }

  public override setColorScheme(colorScheme: "dark" | "light"): void {
    this.#outlineMaterial.color.copy(colorScheme === "dark" ? DARK_OUTLINE : LIGHT_OUTLINE);
    this.#outlineMaterial.needsUpdate = true;
  }

  #ensureCapacity(numCubes: number) {
    if (numCubes > this.#maxInstances) {
      const newCapacity = Math.trunc(numCubes * 1.5) + 16;
      this.#maxInstances = newCapacity;

      this.#instanceOpacity = new THREE.InstancedBufferAttribute(
        new Float32Array(this.#maxInstances),
        1,
      );
      this.#instanceBottomScale = new THREE.InstancedBufferAttribute(
        new Float32Array(this.#maxInstances),
        1,
      );
      this.#instanceTopScale = new THREE.InstancedBufferAttribute(
        new Float32Array(this.#maxInstances),
        1,
      );
      this.#geometry.setAttribute("instanceOpacity", this.#instanceOpacity);
      this.#geometry.setAttribute("instanceBottomScale", this.#instanceBottomScale);
      this.#geometry.setAttribute("instanceTopScale", this.#instanceTopScale);

      this.#mesh.removeFromParent();
      this.#mesh.dispose();
      this.#mesh = new THREE.InstancedMesh(this.#geometry, this.#material, this.#maxInstances);
      this.#mesh.frustumCulled = false;
      this.add(this.#mesh);

      // THREE.js doesn't correctly recompute the new max instance count when dynamically
      // reassigning the attribute of InstancedBufferGeometry, so we just create a new geometry
      this.#outlineGeometry.dispose();
      this.#outlineGeometry = new THREE.InstancedBufferGeometry();
      (this.#outlineGeometry as THREE.BufferGeometry).copy(this.#sharedEdgesGeometry);
      this.#outlineGeometry.instanceCount = newCapacity;
      this.#outlineMatrices = shareInstanceMatrix(this.#outlineGeometry, this.#mesh.instanceMatrix);
      this.#outlineGeometry.setAttribute("instanceBottomScale", this.#instanceBottomScale);
      this.#outlineGeometry.setAttribute("instanceTopScale", this.#instanceTopScale);
      this.#outline.geometry = this.#outlineGeometry;
    }
  }

  #updateMesh(cylinders: CylinderPrimitive[]) {
    let isTransparent = false;

    this.#ensureCapacity(cylinders.length);

    const overrideColor = this.userData.settings.color
      ? stringToRgba(tempRgba, this.userData.settings.color)
      : undefined;

    let i = 0;
    for (const cylinder of cylinders) {
      const color = overrideColor ?? cylinder.color;
      if (color.a < 1) {
        isTransparent = true;
      }
      this.#mesh.setColorAt(i, rgbToThreeColor(tempColor, color));
      this.#instanceOpacity.setX(i, color.a);
      this.#instanceBottomScale.setX(i, cylinder.bottom_scale);
      this.#instanceTopScale.setX(i, cylinder.top_scale);
      this.#mesh.setMatrixAt(
        i,
        tempMat4.compose(
          tempVec3.set(
            cylinder.pose.position.x,
            cylinder.pose.position.y,
            cylinder.pose.position.z,
          ),
          tempQuat.set(
            cylinder.pose.orientation.x,
            cylinder.pose.orientation.y,
            cylinder.pose.orientation.z,
            cylinder.pose.orientation.w,
          ),
          tempVec3_2.set(cylinder.size.x, cylinder.size.y, cylinder.size.z),
        ),
      );
      i++;
    }

    if (this.#material.transparent !== isTransparent) {
      this.#material.transparent = isTransparent;
      this.#material.depthWrite = !isTransparent;
      this.#material.needsUpdate = true;
    }

    if (this.#mesh.count === 0 && cylinders.length > 0) {
      // needed to make colors work: https://discourse.threejs.org/t/instancedmesh-color-doesnt-work-when-initial-count-is-0/41355
      this.#material.needsUpdate = true;
    }
    this.#mesh.count = cylinders.length;
    this.#outlineGeometry.instanceCount = cylinders.length;
    this.#mesh.instanceMatrix.needsUpdate = true;
    this.#outlineMatrices.needsUpdate = true;
    this.#instanceOpacity.needsUpdate = true;
    this.#instanceBottomScale.needsUpdate = true;
    this.#instanceTopScale.needsUpdate = true;

    // may be null if we were initialized with count 0 and still have 0 primitives
    if (this.#mesh.instanceColor) {
      this.#mesh.instanceColor.needsUpdate = true;
    }
  }

  public override dispose(): void {
    this.#mesh.dispose();
    this.#geometry.dispose();
    this.#material.dispose();
    this.#outlineMaterial.dispose();
    this.#outlineGeometry.dispose();
  }

  public override update(
    topic: string | undefined,
    entity: SceneEntity | undefined,
    settings: LayerSettingsEntity,
    receiveTime: bigint,
  ): void {
    super.update(topic, entity, settings, receiveTime);
    if (entity) {
      const lifetimeNs = toNanoSec(entity.lifetime);
      this.userData.expiresAt = lifetimeNs === 0n ? undefined : receiveTime + lifetimeNs;
      this.#updateMesh(entity.cylinders);
      this.#outline.visible = settings.showOutlines ?? true;
    }
  }

  public updateSettings(settings: LayerSettingsEntity): void {
    this.update(this.userData.topic, this.userData.entity, settings, this.userData.receiveTime);
  }
}
function createGeometry() {
  const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  cylinderGeometry.rotateX(Math.PI / 2);
  cylinderGeometry.computeBoundingSphere();
  return cylinderGeometry;
}

function createEdgesGeometry(geometry: THREE.CylinderGeometry) {
  const cylinderEdgesGeometry = new THREE.EdgesGeometry(geometry, 40);
  cylinderEdgesGeometry.computeBoundingSphere();
  return cylinderEdgesGeometry;
}

/** Scales a unit cylinder's cross-section from bottom_scale (z = -0.5) to top_scale (z = 0.5) */
function taper(position: THREE.Node<"vec3">): THREE.Node<"vec3"> {
  const bottom = attribute("instanceBottomScale", "float");
  const top = attribute("instanceTopScale", "float");
  return vec3(position.xy.mul(mix(bottom, top, position.z.add(0.5))), position.z);
}

class CylinderMaterial extends MeshStandardMaterialWithInstanceOpacity {
  // Node materials share compiled shaders by `type`; the override keeps the taper out of the plain
  // material's cache entry. three.js defines `type` as a static getter.
  // eslint-disable-next-line @lichtblick/no-getters-setters
  public static override get type(): string {
    return "CylinderMaterial";
  }

  public constructor() {
    super({ metalness: 0, roughness: 1, dithering: true });
  }

  // Taper before the InstancedMesh's instance transform, which runs in super.setupPosition
  public override setupPosition(builder: THREE.NodeBuilder): THREE.Node {
    positionLocal.assign(taper(positionLocal));
    return super.setupPosition(builder);
  }
}

/** Instanced outline: reads the cylinder instance matrices from the outline geometry's own attributes */
class CylinderOutlineMaterial extends THREE.LineBasicNodeMaterial {
  public constructor() {
    super();
    const matrix = mat4(
      attribute("instanceMatrix0", "vec4"),
      attribute("instanceMatrix1", "vec4"),
      attribute("instanceMatrix2", "vec4"),
      attribute("instanceMatrix3", "vec4"),
    );
    this.positionNode = matrix.mul(vec4(taper(positionGeometry), 1)).xyz;
  }
}

/** Exposes `matrices` (an InstancedMesh's instanceMatrix) to `geometry` as four vec4 columns */
function shareInstanceMatrix(
  geometry: THREE.BufferGeometry,
  matrices: THREE.InstancedBufferAttribute,
): THREE.InstancedInterleavedBuffer {
  const buffer = new THREE.InstancedInterleavedBuffer(matrices.array, 16, 1);
  for (let i = 0; i < 4; i++) {
    geometry.setAttribute(
      `instanceMatrix${i}`,
      new THREE.InterleavedBufferAttribute(buffer, 4, i * 4),
    );
  }
  return buffer;
}
