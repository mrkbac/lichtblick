// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { EDGE_LINE_SEGMENTS_NAME } from "@lichtblick/suite-base/panels/ThreeDeeRender/ModelCache";
import { toError } from "@lichtblick/suite-base/util/toError";

import { RenderableMarker } from "./RenderableMarker";
import { makeStandardMaterial } from "./materials";
import type { Renderer } from "../../Renderer";
import { rgbToThreeColor } from "../../color";
import { disposeMeshesRecursive } from "../../dispose";
import { Marker } from "../../ros";
import { removeLights, replaceMaterials } from "../models";

export const MESH_FETCH_FAILED = "MESH_FETCH_FAILED";

export class RenderableMeshResource extends RenderableMarker {
  #mesh: THREE.Group | THREE.Scene | undefined;
  #material: THREE.MeshStandardMaterial;
  #referenceUrl: string | undefined;
  /** Whether the marker alpha also fades the model's own materials, see the constructor */
  #alphaFadesModelMaterials: boolean;

  /** Track updates to avoid race conditions when asynchronously loading models */
  #updateId = 0;

  public constructor(
    topic: string,
    marker: Marker,
    receiveTime: bigint | undefined,
    renderer: Renderer,
    /**
     * `alphaFadesModelMaterials`: the marker alpha also fades materials that come with the model
     * (embedded or vertex colored), which otherwise ignore the marker color.
     */
    options?: { referenceUrl?: string; alphaFadesModelMaterials?: boolean },
  ) {
    super(topic, marker, receiveTime, renderer);

    this.#material = makeStandardMaterial(marker.color);
    this.#referenceUrl = options?.referenceUrl;
    this.#alphaFadesModelMaterials = options?.alphaFadesModelMaterials ?? false;
    this.update(marker, receiveTime, true);
  }

  public override dispose(): void {
    this.#updateId++;
    if (this.#mesh) {
      disposeMeshesRecursive(this.#mesh);
    }
    this.#material.dispose();
  }

  public override update(
    newMarker: Marker,
    receiveTime: bigint | undefined,
    // eslint-disable-next-line @lichtblick/no-boolean-parameters
    forceLoad?: boolean,
  ): void {
    const prevMarker = this.userData.marker;
    super.update(newMarker, receiveTime);
    const marker = this.userData.marker;

    const transparent = marker.color.a < 1;
    if (transparent !== this.#material.transparent) {
      this.#material.transparent = transparent;
      this.#material.depthWrite = !transparent;
      this.#material.needsUpdate = true;
    }

    rgbToThreeColor(this.#material.color, marker.color);
    this.#material.opacity = marker.color.a;

    if (forceLoad === true || marker.mesh_resource !== prevMarker.mesh_resource) {
      const curUpdateId = ++this.#updateId;

      const opts = { useEmbeddedMaterials: marker.mesh_use_embedded_materials };
      const errors = this.renderer.settings.errors;
      if (this.#mesh) {
        this.remove(this.#mesh);
        disposeMeshesRecursive(this.#mesh);
        this.#mesh = undefined;
      }
      errors.remove(this.userData.settingsPath, MESH_FETCH_FAILED);
      this.#loadModel(marker.mesh_resource, opts)
        .then((mesh) => {
          if (!mesh) {
            return;
          }
          if (this.#updateId !== curUpdateId) {
            // another update has started
            disposeMeshesRecursive(mesh);
            return;
          }
          this.#mesh = mesh;
          this.add(mesh);
          this.#updateOutlineVisibility();
          this.#fadeModelMaterials();

          // Render a new frame now that the model is loaded
          this.renderer.queueAnimationFrame();
        })
        .catch((err: unknown) => {
          errors.add(
            this.userData.settingsPath,
            MESH_FETCH_FAILED,
            `Unhandled error loading mesh from "${marker.mesh_resource}": ${toError(err).message}`,
          );
        });
    }
    this.#updateOutlineVisibility();
    this.#fadeModelMaterials();

    this.scale.set(marker.scale.x, marker.scale.y, marker.scale.z);
  }

  #fadeModelMaterials(): void {
    if (!this.#alphaFadesModelMaterials || !this.#mesh) {
      return;
    }
    const alpha = this.userData.marker.color.a;
    this.#mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      const mesh: THREE.Mesh = child;
      const materials = [mesh.material].flat().map((material) => {
        if (material === this.#material) {
          return material;
        }
        // Model materials are shared with the model cache: fade a copy that remembers the original
        let faded = material;
        if (material.userData.baseOpacity == undefined) {
          if (alpha >= 1) {
            return material;
          }
          faded = material.clone();
          faded.userData.baseOpacity = material.opacity;
          faded.userData.baseTransparent = material.transparent;
        }
        const baseTransparent = faded.userData.baseTransparent as boolean;
        faded.opacity = (faded.userData.baseOpacity as number) * alpha;
        const transparent = baseTransparent || alpha < 1;
        if (faded.transparent !== transparent) {
          faded.transparent = transparent;
          faded.depthWrite = !transparent;
          faded.needsUpdate = true;
        }
        return faded;
      });
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    });
  }

  #updateOutlineVisibility(): void {
    const showOutlines = this.getSettings()?.showOutlines ?? true;
    this.traverse((lineSegments) => {
      // Want to avoid picking up the LineSegments from the model itself
      // only update line segments that we've added with the special name
      if (
        lineSegments instanceof THREE.LineSegments &&
        lineSegments.name === EDGE_LINE_SEGMENTS_NAME
      ) {
        lineSegments.visible = showOutlines;
      }
    });
  }

  async #loadModel(
    url: string,
    opts: { useEmbeddedMaterials: boolean },
  ): Promise<THREE.Group | THREE.Scene | undefined> {
    const updateId = this.#updateId;
    const cachedModel = await this.renderer.modelCache.load(
      url,
      { referenceUrl: this.#referenceUrl },
      (err) => {
        if (this.#updateId !== updateId) {
          return;
        }
        this.renderer.settings.errors.add(
          this.userData.settingsPath,
          MESH_FETCH_FAILED,
          `Error loading mesh from "${url}": ${err.message}`,
        );
      },
    );

    if (this.#updateId !== updateId) {
      return undefined;
    }
    if (!cachedModel) {
      if (!this.renderer.settings.errors.hasError(this.userData.settingsPath, MESH_FETCH_FAILED)) {
        this.renderer.settings.errors.add(
          this.userData.settingsPath,
          MESH_FETCH_FAILED,
          `Failed to load mesh from "${url}"`,
        );
      }
      return undefined;
    }

    const mesh = cachedModel.clone(true);
    removeLights(mesh);
    if (!opts.useEmbeddedMaterials || cachedModel.hasEmbeddedMaterials === false) {
      replaceMaterials(mesh, this.#material, { preserveVertexColors: opts.useEmbeddedMaterials });
    }

    return mesh;
  }
}
