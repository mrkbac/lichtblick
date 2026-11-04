// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import i18next from "i18next";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import type { IRenderer } from "../IRenderer";
import { Renderable } from "../Renderable";
import { SceneExtension } from "../SceneExtension";
import { AnyFrameId, CoordinateFrame } from "../transforms";
import {
  frameTransform,
  KIND_POINTS,
  MeasureKind,
  MeasureSummary,
  summarize,
} from "./measure/geometry";

export type { MeasureKind } from "./measure/geometry";

type MeasurementState = "idle" | "active";

export type MeasurementInfo = {
  id: number;
  kind: MeasureKind;
  summary: MeasureSummary;
  /** False while the measurement is still being placed */
  complete: boolean;
};

const MEASURE_KIND_KEYS = {
  point: "measurePoint",
  distance: "measureDistance",
  polyline: "measurePolyline",
  angle: "measureAngle",
  area: "measureArea",
  height: "measureHeight",
  profile: "measureProfile",
} as const satisfies Record<MeasureKind, string>;

export function measureKindLabel(kind: MeasureKind): string {
  return i18next.t(`threeDee:${MEASURE_KIND_KEYS[kind]}`);
}

/** A renderOrder value that should result in rendering after most/all other objects in the scene */
const LATE_RENDER_ORDER = 9999999;
const COLOR = 0xffb300;
const SELECTED_COLOR = 0x00e5ff;
/** Grab radius around a vertex, in CSS pixels */
const VERTEX_GRAB_RADIUS = 8;
/** Max movement for a right-click to count as "finish" rather than a pan */
const RIGHT_CLICK_SLOP = 4;
// ponytail: one GPU pick per sample of the visible surface; resample from a depth readback if
// profiles over huge point clouds hitch
const PROFILE_SAMPLES = 64;

const XY_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const tempVec2 = new THREE.Vector2();
const tempScreen = new THREE.Vector2();
const tempVec3 = new THREE.Vector3();
const tempVec3b = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const tempRaycaster = new THREE.Raycaster();

/**
 * A material that interprets the input mesh coordinates in pixel space, regardless of the camera
 * perspective/zoom level.
 */
class FixedSizeMeshMaterial extends THREE.ShaderMaterial {
  public constructor({
    color,
    ...params
  }: { color: THREE.ColorRepresentation } & THREE.MaterialParameters) {
    super({
      ...params,
      vertexShader: /* glsl */ `
        #include <common>
        uniform vec2 canvasSize;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(0., 0., 0., 1.);

          // Adapted from THREE.ShaderLib.sprite
          vec2 scale;
          scale.x = length(vec3(modelMatrix[0].xyz));
          scale.y = length(vec3(modelMatrix[1].xyz));

          gl_Position = projectionMatrix * mvPosition;

          // Add position after projection to maintain constant pixel size
          gl_Position.xy += position.xy / canvasSize * scale * gl_Position.w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() {
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        canvasSize: { value: [0, 0] },
        color: { value: new THREE.Color(color).convertSRGBToLinear() },
      },
    });
  }
}

type Measurement = {
  id: number;
  kind: MeasureKind;
  /** Frame the points are stored in; the measurement moves with this frame */
  frameId: AnyFrameId;
  /** Points in `frameId`. While placing, the last point follows the cursor. */
  points: THREE.Vector3[];
  complete: boolean;
  /** Profile samples in `frameId`: the point on the line and the surface hit below it */
  profileLine: THREE.Vector3[];
  profileHit: THREE.Vector3[];
  /** Positioned at the pose of `frameId` in the render frame */
  group: THREE.Group;
  lines: LineSegments2;
  lineCapacity: number;
  vertices: THREE.Mesh[];
  /** Corner of the height triangle, in `frameId` */
  heightCorner?: THREE.Vector3;
  labels: HTMLDivElement[];
  labelAnchors: THREE.Vector3[];
  summary: MeasureSummary;
  /** frameId → result frame transform the summary was computed with */
  resultMatrix: THREE.Matrix4;
  dirty: boolean;
};

interface MeasurementToolEventMap extends THREE.Object3DEventMap {
  "foxglove.measure-start": object;
  "foxglove.measure-end": object;
  "foxglove.measure-change": object;
}

/**
 * Potree-style measurements: point, distance, polyline, angle, area, height and height profile.
 * Points snap to the nearest rendered surface via the GPU picker (ground plane fallback), can be
 * dragged to edit, and stay attached to the frame that was displayed when they were made.
 */
export class MeasurementTool extends SceneExtension<Renderable, MeasurementToolEventMap> {
  public static extensionId = "foxglove.MeasurementTool";

  public state: MeasurementState = "idle";
  public kind: MeasureKind = "distance";
  /** Frame results are expressed in; undefined means the display frame */
  public resultFrameId: string | undefined;
  public selectedId: number | undefined;
  public measurements: readonly MeasurementInfo[] = [];

  #circleGeometry = new THREE.CircleGeometry(5, 16);
  #circleMaterial = new FixedSizeMeshMaterial({
    color: COLOR,
    depthTest: false,
    depthWrite: false,
  });
  #selectedCircleMaterial = new FixedSizeMeshMaterial({
    color: SELECTED_COLOR,
    depthTest: false,
    depthWrite: false,
  });
  #lineMaterial = new LineMaterial({
    color: COLOR,
    linewidth: 2,
    depthTest: false,
    depthWrite: false,
  });
  #selectedLineMaterial = new LineMaterial({
    color: SELECTED_COLOR,
    linewidth: 2,
    depthTest: false,
    depthWrite: false,
  });

  #items: Measurement[] = [];
  #draft?: Measurement;
  #nextId = 1;
  #changed = false;
  #renderFrameId: AnyFrameId = CoordinateFrame.FALLBACK_FRAME_ID;
  #fixedFrameId: AnyFrameId = CoordinateFrame.FALLBACK_FRAME_ID;

  #cursor = new THREE.Vector2();
  #cursorDirty = false;
  #drag?: { item: Measurement; index: number };
  #dragCursor = new THREE.Vector2();
  #dragPending = false;
  #suppressClick = false;
  #rightDown = new THREE.Vector2(NaN, NaN);
  #labelContainer?: HTMLDivElement;

  public constructor(renderer: IRenderer, name: string = MeasurementTool.extensionId) {
    super(name, renderer);
    renderer.on("endFrame", this.#updateLabels);
  }

  public override dispose(): void {
    if (this.state === "active") {
      this.#stopListening();
    }
    this.renderer.off("endFrame", this.#updateLabels);
    for (const item of this.#items) {
      this.#disposeItem(item);
    }
    if (this.#draft) {
      this.#disposeItem(this.#draft);
    }
    this.#labelContainer?.remove();
    this.#circleGeometry.dispose();
    this.#circleMaterial.dispose();
    this.#selectedCircleMaterial.dispose();
    this.#lineMaterial.dispose();
    this.#selectedLineMaterial.dispose();
    super.dispose();
  }

  public startMeasuring(kind: MeasureKind = this.kind): void {
    this.#discardDraft();
    this.kind = kind;
    if (this.state === "active") {
      this.#emitChange();
      return;
    }
    this.state = "active";
    // A selection re-renders only the selected layer, which would hide everything else from picking
    this.renderer.setSelectedRenderable(undefined);
    const canvas = this.renderer.input;
    canvas.addListener("click", this.#handleClick);
    canvas.addListener("mousemove", this.#handleMouseMove);
    canvas.addListener("mousedown", this.#handleMouseDown);
    canvas.addListener("mouseup", this.#handleMouseUp);
    this.renderer.gl.domElement.parentElement?.addEventListener(
      "pointerdown",
      this.#handlePointerDown,
      { capture: true },
    );
    window.addEventListener("keydown", this.#handleKeyDown);
    this.dispatchEvent({ type: "foxglove.measure-start" });
    this.#emitChange();
  }

  public stopMeasuring(): void {
    if (this.state === "idle") {
      return;
    }
    this.#finishDraft();
    this.#discardDraft();
    this.state = "idle";
    this.#stopListening();
    this.dispatchEvent({ type: "foxglove.measure-end" });
    this.#emitChange();
  }

  public setResultFrame(frameId: string | undefined): void {
    this.resultFrameId = frameId;
    this.#markAllDirty();
  }

  public select(id: number | undefined): void {
    this.selectedId = id;
    for (const item of this.#items) {
      const selected = item.id === id;
      item.lines.material = selected ? this.#selectedLineMaterial : this.#lineMaterial;
      for (const vertex of item.vertices) {
        vertex.material = selected ? this.#selectedCircleMaterial : this.#circleMaterial;
      }
      for (const label of item.labels) {
        label.style.outline = selected ? "1px solid #00e5ff" : "";
      }
    }
    this.#emitChange();
  }

  public removeMeasurement(id: number): void {
    const index = this.#items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    this.#disposeItem(this.#items[index]!);
    this.#items.splice(index, 1);
    if (this.selectedId === id) {
      this.selectedId = undefined;
    }
    this.#emitChange();
  }

  public clearAll(): void {
    for (const item of this.#items) {
      this.#disposeItem(item);
    }
    this.#items = [];
    this.selectedId = undefined;
    this.#discardDraft();
    this.#emitChange();
  }

  /** Name of the frame results are currently expressed in */
  public resultFrameName(): string {
    const frameId = this.resultFrameId ?? this.#renderFrameId;
    return typeof frameId === "string" ? frameId : "";
  }

  /** Plain-text description of one or all measurements, for the clipboard */
  public copyText(id?: number): string {
    const frame = this.resultFrameName();
    return this.measurements
      .filter((info) => info.complete && (id == undefined || info.id === id))
      .map(({ kind, summary }) =>
        [
          `${measureKindLabel(kind)}: ${summary.label}`,
          `${i18next.t("threeDee:measureFrame")}: ${frame}`,
          ...summary.details,
          ...(summary.profile
            ? [
                "Profile (distance, z):",
                ...summary.profile.x.map(
                  (x, i) => `${x.toFixed(3)}, ${summary.profile!.z[i]!.toFixed(3)}`,
                ),
              ]
            : []),
        ].join("\n"),
      )
      .join("\n\n");
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: AnyFrameId,
    fixedFrameId: AnyFrameId,
  ): void {
    super.startFrame(currentTime, renderFrameId, fixedFrameId);
    this.#renderFrameId = renderFrameId;
    this.#fixedFrameId = fixedFrameId;
    const { canvasSize } = this.renderer.input;
    for (const material of [this.#circleMaterial, this.#selectedCircleMaterial]) {
      material.uniforms.canvasSize!.value[0] = canvasSize.x;
      material.uniforms.canvasSize!.value[1] = canvasSize.y;
    }
    this.#lineMaterial.resolution.copy(canvasSize);
    this.#selectedLineMaterial.resolution.copy(canvasSize);

    for (const item of this.#items) {
      this.#updateItem(item, currentTime);
    }
    if (this.#draft) {
      this.#updateItem(this.#draft, currentTime);
    }

    // Snap at most once per frame while dragging; pointermove can fire several times per frame
    if (this.#drag && this.#dragPending) {
      this.#snapDrag();
    }

    if (this.#cursorDirty && this.state === "active" && !this.#drag) {
      this.#cursorDirty = false;
      this.#draft ??= this.#createItem(this.kind);
      if (this.#draft.points.length === 0) {
        this.#draft.points.push(new THREE.Vector3());
      }
      this.#snapToLocal(this.#cursor, this.#draft, this.#draft.points.at(-1)!);
      this.#draft.dirty = true;
      this.#updateItem(this.#draft, currentTime);
    }

    if (this.#changed) {
      this.#changed = false;
      this.#rebuildInfos();
    }
  }

  #updateItem(item: Measurement, currentTime: bigint): void {
    const tree = this.renderer.transformTree;
    const group = item.group;
    group.visible = frameTransform(
      group.matrix,
      tree,
      this.#renderFrameId,
      this.#fixedFrameId,
      item.frameId,
      currentTime,
    );
    if (!group.visible) {
      return;
    }
    group.updateMatrixWorld(true);
    const ok = frameTransform(
      tempMatrix,
      this.renderer.transformTree,
      this.resultFrameId ?? this.#renderFrameId,
      this.#fixedFrameId,
      item.frameId,
      currentTime,
    );
    if (!ok) {
      // Don't show values from another frame under the selected frame's name
      const unavailable = i18next.t("threeDee:measureFrameUnavailable");
      if (item.summary.label !== unavailable) {
        item.summary = { label: unavailable, segmentLabels: [], details: [] };
        this.#rebuildLabels(item);
        this.#changed ||= item.complete;
      }
      item.dirty = true;
      return;
    }
    if (item.dirty || !tempMatrix.equals(item.resultMatrix)) {
      item.resultMatrix.copy(tempMatrix);
      item.dirty = false;
      this.#recompute(item);
    }
  }

  /** Recompute values, geometry and labels after points or frames changed (not every frame) */
  #recompute(item: Measurement): void {
    const toResult = item.resultMatrix;
    const points = item.points.map((p) => p.clone().applyMatrix4(toResult));
    let samples = points;
    if (item.kind === "profile" && item.profileLine.length > 0) {
      samples = item.profileLine.map((line, i) => {
        const z = tempVec3.copy(item.profileHit[i]!).applyMatrix4(toResult).z;
        const p = line.clone().applyMatrix4(toResult);
        return p.setZ(z);
      });
    }
    item.summary = summarize(item.kind, points, samples);

    // Height triangle: horizontal leg at the first point's height, then vertical up/down to the second
    item.heightCorner = undefined;
    if (item.kind === "height" && points.length === 2) {
      item.heightCorner = new THREE.Vector3(points[1]!.x, points[1]!.y, points[0]!.z).applyMatrix4(
        tempMatrix.copy(toResult).invert(),
      );
    }

    this.#rebuildGeometry(item);
    this.#rebuildLabels(item);
    // The list only shows finished measurements; the draft's live values are in its labels
    this.#changed ||= item.complete;
  }

  #rebuildGeometry(item: Measurement): void {
    const { points, kind } = item;
    const closed = kind === "area" && points.length >= 3;
    const segmentCount = Math.max(0, points.length - 1) + (closed ? 1 : 0) + 2;
    if (segmentCount > item.lineCapacity) {
      item.lineCapacity = Math.max(segmentCount, item.lineCapacity * 2);
      item.lines.geometry.setPositions(new Float32Array(item.lineCapacity * 6));
    }
    const buffer = (
      item.lines.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
    ).data;
    const array = buffer.array as Float32Array;
    let n = 0;
    const push = (a: THREE.Vector3, b: THREE.Vector3) => {
      a.toArray(array, n * 6);
      b.toArray(array, n * 6 + 3);
      n++;
    };
    for (let i = 1; i < points.length; i++) {
      push(points[i - 1]!, points[i]!);
    }
    if (closed) {
      push(points.at(-1)!, points[0]!);
    }
    if (item.heightCorner) {
      push(points[0]!, item.heightCorner);
      push(item.heightCorner, points[1]!);
    }
    buffer.needsUpdate = true;
    item.lines.geometry.instanceCount = n;
    item.lines.visible = n > 0;

    const selected = item.id === this.selectedId;
    while (item.vertices.length < points.length) {
      const vertex = new THREE.Mesh(
        this.#circleGeometry,
        selected ? this.#selectedCircleMaterial : this.#circleMaterial,
      );
      vertex.userData.picking = false;
      vertex.renderOrder = LATE_RENDER_ORDER;
      item.vertices.push(vertex);
      item.group.add(vertex);
    }
    while (item.vertices.length > points.length) {
      item.group.remove(item.vertices.pop()!);
    }
    points.forEach((p, i) => item.vertices[i]!.position.copy(p));
  }

  #rebuildLabels(item: Measurement): void {
    const { points, summary, kind } = item;
    const texts = [summary.label, ...summary.segmentLabels];
    while (item.labelAnchors.length < texts.length) {
      item.labelAnchors.push(new THREE.Vector3());
    }
    const [main] = item.labelAnchors;
    if (points.length > 0 && main) {
      if (kind === "angle" && points.length >= 2) {
        main.copy(points[1]!);
      } else if (kind === "area") {
        main.set(0, 0, 0);
        points.forEach((p) => main.add(p));
        main.divideScalar(points.length);
      } else if (kind === "distance" || kind === "height") {
        main.copy(points[0]!).lerp(points.at(-1)!, 0.5);
      } else {
        main.copy(points.at(-1)!);
      }
    }
    for (let i = 1; i < texts.length; i++) {
      const a = points[i - 1]!;
      const b = points[i % points.length]!;
      item.labelAnchors[i]!.copy(a).lerp(b, 0.5);
    }

    const container = this.#getLabelContainer();
    if (!container) {
      return;
    }
    while (item.labels.length < texts.length) {
      const label = document.createElement("div");
      Object.assign(label.style, {
        position: "absolute",
        left: "0",
        top: "0",
        padding: "1px 4px",
        borderRadius: "3px",
        background: "rgba(0, 0, 0, 0.75)",
        color: "white",
        font: "11px/1.4 monospace",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        display: "none",
      });
      container.appendChild(label);
      item.labels.push(label);
    }
    while (item.labels.length > texts.length) {
      item.labels.pop()!.remove();
    }
    texts.forEach((text, i) => {
      const label = item.labels[i]!;
      if (label.textContent !== text) {
        label.textContent = text;
      }
      label.style.fontWeight = i === 0 ? "bold" : "normal";
      label.style.outline = item.id === this.selectedId ? "1px solid #00e5ff" : "";
    });
  }

  #getLabelContainer(): HTMLDivElement | undefined {
    if (this.#labelContainer) {
      return this.#labelContainer;
    }
    const canvas = this.renderer.gl.domElement;
    if (!canvas.parentElement) {
      return undefined;
    }
    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
    });
    canvas.after(container);
    this.#labelContainer = container;
    return container;
  }

  /** Keep labels glued to their anchors in screen space; runs after the camera is final */
  #updateLabels = (): void => {
    const camera = this.renderer.cameraHandler.getActiveCamera();
    const { width, height } = this.renderer.input.canvasSize;
    const update = (item: Measurement) => {
      item.labels.forEach((label, i) => {
        const anchor = item.labelAnchors[i];
        let visible = item.group.visible && anchor != undefined && label.textContent !== "";
        if (visible) {
          tempVec3.copy(anchor!).applyMatrix4(item.group.matrixWorld).project(camera);
          visible = tempVec3.z >= -1 && tempVec3.z <= 1;
        }
        if (!visible) {
          label.style.display = "none";
          return;
        }
        const x = ((tempVec3.x + 1) / 2) * width;
        const y = ((1 - tempVec3.y) / 2) * height;
        // The main label sits above its anchor so it doesn't cover the vertex; the area label
        // marks the centroid, which has no vertex, so it stays centered off the edge labels
        const shift = i === 0 && item.kind !== "area" ? "-130%" : "-50%";
        label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${shift})`;
        label.style.display = "";
      });
    };
    this.#items.forEach(update);
    if (this.#draft) {
      update(this.#draft);
    }
  };

  #createItem(kind: MeasureKind): Measurement {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(new Float32Array(4 * 6));
    const lines = new LineSegments2(geometry, this.#lineMaterial);
    lines.userData.picking = false;
    lines.frustumCulled = false;
    lines.renderOrder = LATE_RENDER_ORDER;
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.add(lines);
    this.add(group);
    // The display frame at creation time is the frame the measurement stays attached to
    return {
      id: this.#nextId++,
      kind,
      frameId: this.#renderFrameId,
      points: [],
      complete: false,
      profileLine: [],
      profileHit: [],
      group,
      lines,
      lineCapacity: 4,
      vertices: [],
      labels: [],
      labelAnchors: [],
      summary: { label: "", segmentLabels: [], details: [] },
      resultMatrix: new THREE.Matrix4(),
      dirty: true,
    };
  }

  #disposeItem(item: Measurement): void {
    this.remove(item.group);
    item.lines.geometry.dispose();
    for (const label of item.labels) {
      label.remove();
    }
  }

  /**
   * Snap a screen position to the nearest rendered surface (ground plane as fallback) and write it
   * into `out` in the item's frame. Returns false if the cursor is off the canvas, its
   * ray misses everything, or the item's frame is currently unavailable.
   */
  #snapToLocal(cursor: THREE.Vector2, item: Measurement, out: THREE.Vector3): boolean {
    // Hidden means the item's frame isn't in the tree right now (e.g. after a seek), so its matrix
    // is stale and converting into it would misplace the point
    const { width, height } = this.renderer.input.canvasSize;
    // Off-canvas cursors (a drag leaving the panel) keep the point where it last was
    const onCanvas = cursor.x >= 0 && cursor.y >= 0 && cursor.x < width && cursor.y < height;
    if (!item.group.visible || !onCanvas) {
      return false;
    }
    if (!this.renderer.pickPoint(cursor, out)) {
      tempRaycaster.setFromCamera(
        tempVec2.set((cursor.x / width) * 2 - 1, -(cursor.y / height) * 2 + 1),
        this.renderer.cameraHandler.getActiveCamera(),
      );
      if (!tempRaycaster.ray.intersectPlane(XY_PLANE, out)) {
        return false;
      }
    }
    item.group.updateMatrixWorld();
    item.group.worldToLocal(out);
    return true;
  }

  /** Project an item-local point to canvas pixels; returns false if behind the camera */
  #toScreen(item: Measurement, p: THREE.Vector3, out: THREE.Vector2): boolean {
    tempVec3b
      .copy(p)
      .applyMatrix4(item.group.matrixWorld)
      .project(this.renderer.cameraHandler.getActiveCamera());
    const { width, height } = this.renderer.input.canvasSize;
    out.set(((tempVec3b.x + 1) / 2) * width, ((1 - tempVec3b.y) / 2) * height);
    return tempVec3b.z >= -1 && tempVec3b.z <= 1;
  }

  #findVertex(cursor: THREE.Vector2): { item: Measurement; index: number } | undefined {
    let best: { item: Measurement; index: number } | undefined;
    let bestDist = VERTEX_GRAB_RADIUS;
    for (const item of this.#items) {
      if (!item.group.visible) {
        continue;
      }
      for (let index = 0; index < item.points.length; index++) {
        if (this.#toScreen(item, item.points[index]!, tempScreen)) {
          const dist = tempScreen.distanceTo(cursor);
          if (dist <= bestDist) {
            bestDist = dist;
            best = { item, index };
          }
        }
      }
    }
    return best;
  }

  #sampleProfile(item: Measurement): void {
    item.profileLine = [];
    item.profileHit = [];
    if (item.kind !== "profile" || item.points.length < 2) {
      return;
    }
    let total = 0;
    for (let i = 1; i < item.points.length; i++) {
      total += item.points[i - 1]!.distanceTo(item.points[i]!);
    }
    const step = total / PROFILE_SAMPLES;
    const { width, height } = this.renderer.input.canvasSize;
    // Vertices were snapped when placed, so they are their own surface point
    const addVertex = (vertex: THREE.Vector3) => {
      item.profileLine.push(vertex.clone());
      item.profileHit.push(vertex.clone());
    };
    const sample = (linePoint: THREE.Vector3) => {
      const hit = new THREE.Vector3();
      const onScreen =
        this.#toScreen(item, linePoint, tempVec2) &&
        tempVec2.x >= 0 &&
        tempVec2.y >= 0 &&
        tempVec2.x < width &&
        tempVec2.y < height;
      if (onScreen && this.renderer.pickPoint(tempVec2, hit)) {
        item.profileLine.push(linePoint.clone());
        item.profileHit.push(item.group.worldToLocal(hit));
      }
    };
    for (let i = 1; i < item.points.length; i++) {
      const a = item.points[i - 1]!;
      const b = item.points[i]!;
      addVertex(a);
      const length = a.distanceTo(b);
      for (let d = step; d < length; d += step) {
        sample(a.clone().lerp(b, d / length));
      }
    }
    addVertex(item.points.at(-1)!);
  }

  #finishDraft(): void {
    const draft = this.#draft;
    if (!draft) {
      return;
    }
    // Drop the point that follows the cursor
    draft.points.pop();
    this.#draft = undefined;
    if (draft.points.length < KIND_POINTS[draft.kind].min) {
      this.#disposeItem(draft);
      this.#emitChange();
      return;
    }
    draft.complete = true;
    this.#sampleProfile(draft);
    draft.dirty = true;
    this.#items.push(draft);
    this.select(draft.id);
    this.#cursorDirty = true; // start the next measurement under the cursor
    this.renderer.queueAnimationFrame();
  }

  #discardDraft(): void {
    if (this.#draft) {
      this.#disposeItem(this.#draft);
      this.#draft = undefined;
    }
  }

  #markAllDirty(): void {
    for (const item of this.#items) {
      item.dirty = true;
    }
    this.#emitChange();
  }

  #emitChange(): void {
    this.#changed = false;
    this.renderer.queueAnimationFrame();
    this.#rebuildInfos();
  }

  #rebuildInfos(): void {
    this.measurements = this.#items.map((item) => ({
      id: item.id,
      kind: item.kind,
      summary: item.summary,
      complete: item.complete,
    }));
    this.dispatchEvent({ type: "foxglove.measure-change" });
  }

  #stopListening(): void {
    const input = this.renderer.input;
    input.removeListener("click", this.#handleClick);
    input.removeListener("mousemove", this.#handleMouseMove);
    input.removeListener("mousedown", this.#handleMouseDown);
    input.removeListener("mouseup", this.#handleMouseUp);
    this.renderer.gl.domElement.parentElement?.removeEventListener(
      "pointerdown",
      this.#handlePointerDown,
      { capture: true },
    );
    window.removeEventListener("keydown", this.#handleKeyDown);
    this.renderer.gl.domElement.style.cursor = "";
  }

  #handleMouseMove = (cursor: THREE.Vector2): void => {
    this.#cursor.copy(cursor);
    if (this.#drag) {
      return;
    }
    this.#cursorDirty = true;
    this.renderer.gl.domElement.style.cursor = this.#findVertex(cursor) ? "grab" : "";
    this.renderer.queueAnimationFrame();
  };

  #handleClick = (cursor: THREE.Vector2): void => {
    if (this.#suppressClick) {
      this.#suppressClick = false;
      return;
    }
    this.#draft ??= this.#createItem(this.kind);
    const draft = this.#draft;
    if (draft.points.length === 0) {
      draft.points.push(new THREE.Vector3());
    }
    // Place the cursor point where it is now, then add a new point to follow the cursor
    this.#updateItem(draft, this.renderer.currentTime);
    if (!this.#snapToLocal(cursor, draft, draft.points.at(-1)!)) {
      return;
    }
    draft.points.push(draft.points.at(-1)!.clone());
    draft.dirty = true;
    if (draft.points.length - 1 >= KIND_POINTS[draft.kind].max) {
      this.#finishDraft();
    }
    this.renderer.queueAnimationFrame();
  };

  #handleMouseDown = (cursor: THREE.Vector2, _world: unknown, event: MouseEvent): void => {
    if (event.button === 2) {
      this.#rightDown.copy(cursor);
    }
  };

  #handleMouseUp = (cursor: THREE.Vector2, _world: unknown, event: MouseEvent): void => {
    if (event.button === 2 && this.#rightDown.distanceTo(cursor) <= RIGHT_CLICK_SLOP) {
      this.#finishDraft();
    }
  };

  #handlePointerDown = (event: PointerEvent): void => {
    this.#suppressClick = false;
    const canvas = this.renderer.gl.domElement;
    if (event.button !== 0 || event.target !== canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const hit = this.#findVertex(tempVec2.set(event.clientX - rect.left, event.clientY - rect.top));
    if (!hit) {
      return;
    }
    // Keep the camera controls from orbiting while a vertex is dragged
    event.stopPropagation();
    this.#suppressClick = true;
    this.#drag = hit;
    this.#discardDraft();
    this.select(hit.item.id);
    canvas.style.cursor = "grabbing";

    const onMove = (moveEvent: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.#dragCursor.set(moveEvent.clientX - r.left, moveEvent.clientY - r.top);
      this.#dragPending = true;
      this.renderer.queueAnimationFrame();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      // A release between frames must not leave the vertex one move behind
      if (this.#dragPending) {
        this.#snapDrag();
      }
      this.#drag = undefined;
      canvas.style.cursor = "grab";
      this.#sampleProfile(hit.item);
      hit.item.dirty = true;
      this.renderer.queueAnimationFrame();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  #snapDrag(): void {
    this.#dragPending = false;
    const drag = this.#drag;
    if (drag && this.#snapToLocal(this.#dragCursor, drag.item, drag.item.points[drag.index]!)) {
      drag.item.dirty = true;
      this.renderer.queueAnimationFrame();
    }
  }

  #handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    // Only react to keys meant for this panel: pointer over it or focus inside it
    const panel = this.renderer.gl.domElement.parentElement;
    const forThisPanel =
      panel?.matches(":hover") === true ||
      (target != undefined && panel?.contains(target) === true);
    if (!forThisPanel) {
      return;
    }
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable === true
    ) {
      return;
    }
    const placing = (this.#draft?.points.length ?? 0) > 1;
    if (event.key === "Escape") {
      if (placing) {
        this.#finishDraft();
      } else {
        this.stopMeasuring();
      }
      event.preventDefault();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      if (placing) {
        // Remove the last placed point, keeping the one under the cursor
        this.#draft!.points.splice(-2, 1);
        this.#draft!.dirty = true;
        this.renderer.queueAnimationFrame();
      } else if (this.selectedId != undefined) {
        this.removeMeasurement(this.selectedId);
      }
      event.preventDefault();
    }
  };
}
