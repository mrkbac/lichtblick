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
  /** The labels' texts the glyphs were last laid out for, in batch order */
  texts: string[];
};

/**
 * Opaque labels with the same size and color differ only in their glyphs and origin. Draw their
 * glyphs together, each with its label's billboard origin and centering baked in. Keep the
 * originals for picking.
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
    const { color, scale } = marker.userData.marker;
    if (
      !marker.label.visible ||
      color.a !== 1 ||
      marker.label.geometry.instanceCount <= 0 ||
      !isFinitePosition(marker.position) ||
      !Number.isFinite(scale.z)
    ) {
      return;
    }
    const key = [cellKey(marker.position), scale.z, color.r, color.g, color.b].join(":");
    const group = this.#groups.get(key);
    if (group) {
      group.push(marker);
    } else {
      this.#groups.set(key, [marker]);
    }
  }

  public end(): void {
    const chunks = new Map<string, RenderableTextViewFacing[]>();
    for (const [key, group] of this.#groups) {
      // Keep each draw's glyph buffer bounded; large topics fill several batches.
      let chunk: RenderableTextViewFacing[] = [];
      let glyphCount = 0;
      let index = 0;
      for (const marker of group) {
        const count = marker.label.geometry.instanceCount;
        if (glyphCount + count > MAX_BATCH_GLYPHS && chunk.length > 0) {
          chunks.set(`${key}:${index++}`, chunk);
          chunk = [];
          glyphCount = 0;
        }
        chunk.push(marker);
        glyphCount += count;
      }
      chunks.set(`${key}:${index++}`, chunk);
    }
    for (const [key, batch] of this.#batches) {
      if ((chunks.get(key)?.length ?? 0) < 2) {
        this.#dispose(batch);
        this.#batches.delete(key);
      }
    }
    for (const [key, markers] of chunks) {
      const first = markers[0];
      if (!first || markers.length < 2) {
        continue;
      }
      let count = 0;
      for (const marker of markers) {
        count += marker.label.geometry.instanceCount;
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
      const { fontManager, scaleFactor, atlasTexture } = this.#pool;
      const atlasChanged = batch.atlasVersion !== atlasTexture.version;
      if (atlasChanged || batch.scaleFactor !== scaleFactor) {
        const { color, scale } = first.userData.marker;
        const { atlasData } = fontManager;
        mesh.material.setScale((scale.z * scaleFactor) / atlasData.lineHeight);
        mesh.material.setTextureSize(atlasData.width, atlasData.height);
        // Each label's centering is baked into its glyphs below
        mesh.material.setLabelSize(0, 0);
        mesh.material.setColor(
          SRGBToLinear(color.r),
          SRGBToLinear(color.g),
          SRGBToLinear(color.b),
          1,
        );
        const bg = getLuminance(color.r, color.g, color.b) < 0.5 ? 1 : 0;
        mesh.material.setBackgroundColor(bg, bg, bg, 1);
      }
      const texts = markers.map((marker) => marker.userData.marker.text);
      const relayout =
        atlasChanged ||
        texts.length !== batch.texts.length ||
        texts.some((text, i) => text !== batch.texts[i]);
      if (relayout) {
        const array = glyphs.array as Float32Array;
        let offset = 0;
        for (const marker of markers) {
          const { geometry } = marker.label;
          const source = geometry.getAttribute(
            "instanceBoxPosition",
          ) as THREE.InterleavedBufferAttribute;
          const end = offset + geometry.instanceCount * 10;
          array.set(source.data.array.subarray(0, end - offset), offset);
          // Center the label on its origin, as the label's anchor point does for a single label
          const { width, height } = fontManager.layout(marker.userData.marker.text);
          for (let i = offset; i < end; i += 10) {
            array[i]! -= width / 2;
            array[i + 1]! -= height / 2;
            array[i + 2]! -= width / 2;
            array[i + 3]! -= height / 2;
          }
          offset = end;
        }
        glyphs.needsUpdate = true;
        batch.texts = texts;
      }
      batch.atlasVersion = atlasTexture.version;
      batch.scaleFactor = scaleFactor;
      mesh.position.copy(first.position);
      let originsChanged = relayout || count !== mesh.geometry.instanceCount;
      let offset = 0;
      for (const marker of markers) {
        const glyphCount = marker.label.geometry.instanceCount;
        const x = Math.fround(marker.position.x - mesh.position.x);
        const y = Math.fround(marker.position.y - mesh.position.y);
        const z = Math.fround(marker.position.z - mesh.position.z);
        if (
          originsChanged ||
          origins.getX(offset) !== x ||
          origins.getY(offset) !== y ||
          origins.getZ(offset) !== z
        ) {
          for (let j = 0; j < glyphCount; j++) {
            origins.setXYZ(offset + j, x, y, z);
          }
          originsChanged = true;
        }
        offset += glyphCount;
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
    return { mesh, glyphs, origins, atlasVersion: -1, scaleFactor: Number.NaN, texts: [] };
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
