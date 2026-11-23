// SPDX-License-Identifier: MPL-2.0

import { LabelNodeMaterial, type LabelPool } from "@foxglove/three-text/webgpu";
import * as THREE from "three";
import { attribute, context, highpModelViewMatrix, mat4, vec4 } from "three/tsl";

import { cellKey, isFinitePosition, setPickOnly } from "./MarkerBatches";
import { RenderableTextViewFacing } from "./RenderableTextViewFacing";
import { getLuminance, SRGBToLinear } from "../../color";

const GLYPH_ATTRIBUTES = [
  "instanceBoxPosition",
  "instanceCharPosition",
  "instanceUv",
  "instanceBoxSize",
  "instanceCharSize",
] as const;
const MAX_BATCH_GLYPHS = 16_384;

type Batch = {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, LabelNodeMaterial>;
  glyphs: THREE.InstancedInterleavedBuffer;
  origins: THREE.InstancedBufferAttribute;
  atlasVersion: number;
  scaleFactor: number;
};

/**
 * Identical opaque labels share the atlas, appearance and glyph layout. Draw their glyphs
 * together, supplying a separate billboard origin for each glyph. Keep the originals for picking.
 */
export class TextMarkerBatches extends THREE.Object3D {
  readonly #pool: LabelPool;
  readonly #groups = new Map<string, RenderableTextViewFacing[]>();
  readonly #batches = new Map<string, Batch>();

  public constructor(pool: LabelPool) {
    super();
    this.#pool = pool;
    this.userData.picking = false;
  }

  public addMarker(marker: RenderableTextViewFacing): void {
    setPickOnly(marker.label.mesh, { pickOnly: false });
    const { color, text, scale } = marker.userData.marker;
    if (
      !marker.label.visible ||
      color.a !== 1 ||
      marker.label.geometry.instanceCount <= 0 ||
      !isFinitePosition(marker.position) ||
      !Number.isFinite(scale.z)
    ) {
      return;
    }
    const key = [cellKey(marker.position), scale.z, color.r, color.g, color.b, text].join(":");
    const group = this.#groups.get(key);
    if (group) {
      group.push(marker);
    } else {
      this.#groups.set(key, [marker]);
    }
  }

  public end(): void {
    for (const [key, batch] of this.#batches) {
      if ((this.#groups.get(key)?.length ?? 0) < 2) {
        this.#dispose(batch);
        this.#batches.delete(key);
      }
    }
    for (const [key, group] of this.#groups) {
      const first = group[0];
      if (!first || group.length < 2) {
        continue;
      }
      const glyphCount = first.label.geometry.instanceCount;
      const count = glyphCount * group.length;
      if (count > MAX_BATCH_GLYPHS) {
        // Let the original labels retain their GPU buffers for very large glyph sets.
        const previous = this.#batches.get(key);
        if (previous) {
          this.#dispose(previous);
          this.#batches.delete(key);
        }
        continue;
      }
      let batch = this.#batches.get(key);
      if (!batch || batch.origins.count < count) {
        if (batch) {
          this.#dispose(batch);
        }
        batch = this.#createBatch(
          first,
          Math.min(MAX_BATCH_GLYPHS, Math.max(count, (batch?.origins.count ?? 8) * 2)),
        );
        this.#batches.set(key, batch);
      }
      const { glyphs, origins, mesh } = batch;
      const glyphPosition = first.label.geometry.getAttribute("instanceBoxPosition");
      if (
        !(glyphPosition instanceof THREE.InterleavedBufferAttribute) ||
        glyphPosition.data.stride !== 10
      ) {
        mesh.geometry.instanceCount = 0;
        continue;
      }
      const { fontManager, scaleFactor, atlasTexture } = this.#pool;
      if (batch.atlasVersion !== atlasTexture.version || batch.scaleFactor !== scaleFactor) {
        const { color, text, scale } = first.userData.marker;
        const layout = fontManager.layout(text);
        const { atlasData } = fontManager;
        mesh.material.setScale((scale.z * scaleFactor) / atlasData.lineHeight);
        mesh.material.setTextureSize(atlasData.width, atlasData.height);
        mesh.material.setLabelSize(layout.width, layout.height);
        mesh.material.setColor(
          SRGBToLinear(color.r),
          SRGBToLinear(color.g),
          SRGBToLinear(color.b),
          1,
        );
        const bg = getLuminance(color.r, color.g, color.b) < 0.5 ? 1 : 0;
        mesh.material.setBackgroundColor(bg, bg, bg, 1);
      }
      if (batch.atlasVersion !== atlasTexture.version || count > mesh.geometry.instanceCount) {
        const source = glyphPosition.data.array.subarray(0, 10 * glyphCount);
        for (let i = 0; i < group.length; i++) {
          glyphs.array.set(source, i * glyphCount * 10);
        }
        glyphs.needsUpdate = true;
      }
      batch.atlasVersion = atlasTexture.version;
      batch.scaleFactor = scaleFactor;
      mesh.position.copy(first.position);
      let originsChanged = count > mesh.geometry.instanceCount;
      for (const [i, marker] of group.entries()) {
        const offset = i * glyphCount;
        const x = Math.fround(marker.position.x - mesh.position.x);
        const y = Math.fround(marker.position.y - mesh.position.y);
        const z = Math.fround(marker.position.z - mesh.position.z);
        if (
          origins.getX(offset) !== x ||
          origins.getY(offset) !== y ||
          origins.getZ(offset) !== z ||
          count !== mesh.geometry.instanceCount
        ) {
          for (let j = 0; j < glyphCount; j++) {
            origins.setXYZ(offset + j, x, y, z);
          }
          originsChanged = true;
        }
        setPickOnly(marker.label.mesh, { pickOnly: true });
      }
      if (originsChanged) {
        origins.needsUpdate = true;
      }
      mesh.geometry.instanceCount = count;
    }
    this.#groups.clear();
  }

  #createBatch(marker: RenderableTextViewFacing, capacity: number): Batch {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = 0;
    const source = marker.label.geometry;
    geometry.setAttribute("position", source.getAttribute("position").clone());
    geometry.setAttribute("uv", source.getAttribute("uv").clone());
    const glyphs = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * 10), 10);
    glyphs.setUsage(THREE.DynamicDrawUsage);
    GLYPH_ATTRIBUTES.forEach((name, i) => {
      geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(glyphs, 2, i * 2));
    });
    const origins = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    origins.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("labelOrigin", origins);

    const material = new LabelNodeMaterial({ atlasTexture: this.#pool.atlasTexture });
    material.setBillboard(true);
    // three-text uses modelViewMatrix's origin for the billboard. Extend that transform with
    // this glyph's label origin, leaving the existing SDF and depth output in place.
    const translation = mat4(
      vec4(1, 0, 0, 0),
      vec4(0, 1, 0, 0),
      vec4(0, 0, 1, 0),
      vec4(attribute("labelOrigin", "vec3"), 1),
    );
    if (material.vertexNode) {
      material.vertexNode = context(material.vertexNode, {
        modelViewMatrix: highpModelViewMatrix.mul(translation),
      });
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.picking = false;
    mesh.frustumCulled = false;
    this.add(mesh);
    return { mesh, glyphs, origins, atlasVersion: -1, scaleFactor: Number.NaN };
  }

  #dispose({ mesh }: Batch): void {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  public override dispose(): void {
    for (const batch of this.#batches.values()) {
      this.#dispose(batch);
    }
    this.#batches.clear();
    this.#groups.clear();
  }
}
