// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import i18next from "i18next";
import * as THREE from "three";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";
import {
  cameraProjectionMatrix,
  length as lengthNode,
  modelViewMatrix,
  modelWorldMatrix,
  positionGeometry,
  screenDPR,
  screenSize,
  vec2,
  vec4,
} from "three/tsl";
import {
  Line2NodeMaterial,
  MeshBasicNodeMaterial,
  type MeshBasicNodeMaterialParameters,
} from "three/webgpu";

import { Renderable } from "../Renderable";
import type { Renderer } from "../Renderer";
import { SceneExtension } from "../SceneExtension";
import { isThreeDeeShortcut } from "../shortcuts";
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
  /** True while a transform it needs is missing at the current time; `summary` has no values then */
  unavailable: boolean;
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
// One GPU pick per sample, run when the line changes rather than every frame
const PROFILE_SAMPLES = 64;
/**
 * Heights above the line a profile sample looks straight down from. Starting low keeps ceilings and
 * overhangs out; when nothing is below (the line cuts through a hill) it retries from higher up.
 */
const PROFILE_LIFTS = [1, 4, 16, 64];

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
class FixedSizeMeshMaterial extends MeshBasicNodeMaterial {
  public constructor(params: MeshBasicNodeMaterialParameters) {
    super(params);
    // The object's origin projected as usual, then the vertex offset added in clip space, so
    // geometry units are CSS pixels (scaled by the object's x/y scale). screenSize is the render
    // target's size in device pixels, which NDC spans twice; it also keeps the size right in the
    // 1x1 picking pass.
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(0, 0, 0, 1));
    const scale = vec2(
      lengthNode(modelWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz),
      lengthNode(modelWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz),
    );
    const offset = positionGeometry.xy.mul(screenDPR).mul(2).div(screenSize).mul(scale).mul(clip.w);
    this.vertexNode = vec4(clip.xy.add(offset), clip.zw);
  }
}

type Measurement = {
  id: number;
  kind: MeasureKind;
  /** Frame the points are stored in: the fixed frame at creation */
  frameId: AnyFrameId;
  /** Points in `frameId`. While placing, the last point follows the cursor. */
  points: THREE.Vector3[];
  complete: boolean;
  /** Profile samples in `frameId`: the point on the line and the surface hit below it */
  profileLine: THREE.Vector3[];
  profileHit: THREE.Vector3[];
  /** Latest profile sampling run; older runs, and all runs once the item is removed, publish nothing */
  profileRun: number;
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
  /** A transform needed for the summary is missing at the current time */
  unavailable: boolean;
};

interface MeasurementToolEventMap extends THREE.Object3DEventMap {
  "foxglove.measure-start": object;
  "foxglove.measure-end": object;
  "foxglove.measure-change": object;
}

/**
 * Potree-style measurements: point, distance, polyline, angle, area, height and height profile.
 * Points snap to the nearest rendered surface via the GPU picker (ground plane fallback), can be
 * dragged to edit, and stay attached to the world (fixed frame), so they keep marking the same spot
 * while the robot drives, even when the view follows the robot.
 */
export class MeasurementTool extends SceneExtension<Renderable, MeasurementToolEventMap> {
  public static extensionId = "foxglove.MeasurementTool";

  public state: MeasurementState = "idle";
  public kind: MeasureKind = "distance";
  /** Frame results are expressed in; undefined means the display frame */
  public resultFrameId: string | undefined;
  public selectedId: number | undefined;
  public measurements: readonly MeasurementInfo[] = [];

  #circleGeometry = new THREE.CircleGeometry(2.5, 16);
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
  #lineMaterial = new Line2NodeMaterial({
    color: COLOR,
    linewidth: 2,
    depthTest: false,
    depthWrite: false,
  });
  #selectedLineMaterial = new Line2NodeMaterial({
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
  /** The last drag snap; the profile is resampled once it has landed */
  #dragSnap: Promise<boolean> = Promise.resolve(false);
  /** Snap request counter */
  #snapRequest = 0;
  /** Newest snap request per target point; older picks that resolve later are dropped */
  #latestSnap = new WeakMap<THREE.Vector3, number>();
  /** Placement of clicked points, in click order */
  #clicks: Promise<void> = Promise.resolve();
  /** Bumped when measuring stops, so shortcuts still waiting on clicks don't outlive it */
  #session = 0;
  /** Cursor point of a new draft; it joins the draft's points once it first snaps somewhere */
  #firstPreview = new THREE.Vector3();
  #suppressClick = false;
  #rightDown = new THREE.Vector2(NaN, NaN);
  #labelContainer?: HTMLDivElement;

  public constructor(renderer: Renderer) {
    super(MeasurementTool.extensionId, renderer);
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
    this.#session++;
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
    const item = this.#items.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    this.#disposeItem(item);
    this.#items = this.#items.filter((entry) => entry !== item);
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
      .filter((info) => info.complete && !info.unavailable && (id == undefined || info.id === id))
      .map(({ kind, summary: { label, details, profile } }) =>
        [
          `${measureKindLabel(kind)}: ${label}`,
          `${i18next.t("threeDee:measureFrame")}: ${frame}`,
          ...details,
          ...(profile
            ? [
                "Profile (distance, z):",
                ...profile.x.map((x, i) => `${x.toFixed(3)}, ${profile.z[i]!.toFixed(3)}`),
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
      const draft = this.#draft;
      this.#updateItem(draft, currentTime);
      // An existing preview keeps its last snapped position while the pick is pending; a new
      // draft shows nothing until its first snap lands
      const preview = draft.points.at(-1) ?? this.#firstPreview;
      void this.#snapLatest(this.#cursor, draft, preview).then((ok) => {
        if (ok && this.#draft === draft && draft.points.length === 0) {
          draft.points.push(preview);
          this.#firstPreview = new THREE.Vector3();
        }
      });
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
      this.#markUnavailable(item, this.#renderFrameId);
      return;
    }
    group.updateMatrixWorld(true);
    const resultFrameId = this.resultFrameId ?? this.#renderFrameId;
    const ok = frameTransform(
      tempMatrix,
      tree,
      resultFrameId,
      this.#fixedFrameId,
      item.frameId,
      currentTime,
    );
    if (!ok) {
      // Don't show values from another frame under the selected frame's name
      this.#markUnavailable(item, resultFrameId);
      return;
    }
    if (item.dirty || item.unavailable || !tempMatrix.equals(item.resultMatrix)) {
      item.unavailable = false;
      item.resultMatrix.copy(tempMatrix);
      item.dirty = false;
      this.#recompute(item);
    }
  }

  /**
   * Replace the summary with a placeholder naming the missing frame, so stale values from before
   * a seek can't be read or copied. The next frame with the transform recomputes it.
   */
  #markUnavailable(item: Measurement, dstFrameId: AnyFrameId): void {
    item.dirty = true;
    const tree = this.renderer.transformTree;
    // Name the first frame missing from the tree; if all exist, a link between them has no
    // transform at this time, and naming one of the present frames would mislead
    const candidates: AnyFrameId[] = [item.frameId, dstFrameId, this.#fixedFrameId];
    const missing = candidates.find((id) => !tree.hasFrame(id));
    const label =
      typeof missing === "string"
        ? i18next.t("threeDee:measureMissingTransform", { frame: missing })
        : i18next.t("threeDee:measureTransformUnavailable");
    if (item.unavailable && item.summary.label === label) {
      return;
    }
    item.unavailable = true;
    item.summary = { label, segmentLabels: [], details: [] };
    this.#rebuildLabels(item);
    this.#changed ||= item.complete;
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
    // Measured things are almost always part of the world, so stay put in it as the robot moves
    return {
      id: this.#nextId++,
      kind,
      frameId: this.#fixedFrameId,
      points: [],
      complete: false,
      profileLine: [],
      profileHit: [],
      profileRun: 0,
      group,
      lines,
      lineCapacity: 4,
      vertices: [],
      labels: [],
      labelAnchors: [],
      summary: { label: "", segmentLabels: [], details: [] },
      resultMatrix: new THREE.Matrix4(),
      dirty: true,
      unavailable: false,
    };
  }

  #disposeItem(item: Measurement): void {
    item.profileRun++; // stop a pending profile run
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
  async #snapToLocal(
    cursor: THREE.Vector2,
    item: Measurement,
    out: THREE.Vector3,
  ): Promise<boolean> {
    // Hidden means the item's frame isn't in the tree right now (e.g. after a seek), so its matrix
    // is stale and converting into it would misplace the point
    const { width, height } = this.renderer.input.canvasSize;
    // Off-canvas cursors (a drag leaving the panel) keep the point where it last was
    const onCanvas = cursor.x >= 0 && cursor.y >= 0 && cursor.x < width && cursor.y < height;
    if (!item.group.visible || !onCanvas) {
      return false;
    }
    // The item and the camera can move while the pick is read back, so convert the hit and compute
    // the ground plane fallback with their poses at submission
    item.group.updateMatrixWorld();
    const toLocal = new THREE.Matrix4().copy(item.group.matrixWorld).invert();
    tempRaycaster.setFromCamera(
      tempVec2.set((cursor.x / width) * 2 - 1, -(cursor.y / height) * 2 + 1),
      this.renderer.cameraHandler.getActiveCamera(),
    );
    const fallback = tempRaycaster.ray.intersectPlane(XY_PLANE, new THREE.Vector3());
    const hit = (await this.renderer.pickPoint(cursor, new THREE.Vector3())) ?? fallback;
    if (!hit) {
      return false;
    }
    out.copy(hit).applyMatrix4(toLocal);
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

  /**
   * Snaps like #snapToLocal, but only the newest of overlapping requests for `out` writes it (picks
   * resolve asynchronously while the cursor keeps moving)
   */
  async #snapLatest(
    cursor: THREE.Vector2,
    item: Measurement,
    out: THREE.Vector3,
  ): Promise<boolean> {
    const request = ++this.#snapRequest;
    this.#latestSnap.set(out, request);
    const point = new THREE.Vector3().copy(out);
    // A failed pick leaves the point where it was, like a miss
    const ok = await this.#snapToLocal(cursor.clone(), item, point).catch(() => false);
    if (!ok || this.#latestSnap.get(out) !== request) {
      return false;
    }
    out.copy(point);
    item.dirty = true;
    this.renderer.queueAnimationFrame();
    return true;
  }

  async #sampleProfile(item: Measurement): Promise<void> {
    const run = ++item.profileRun;
    item.profileLine = [];
    item.profileHit = [];
    if (item.kind !== "profile" || item.points.length < 2) {
      return;
    }
    // Private to this run: pointer moves, drags and other runs must not change what a pending pick
    // is converted with
    const points = item.points.map((p) => p.clone());
    const camera = new THREE.OrthographicCamera();
    item.group.updateMatrixWorld();
    const world = item.group.matrixWorld.clone();
    const toLocal = world.clone().invert();
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += points[i - 1]!.distanceTo(points[i]!);
    }
    const step = total / PROFILE_SAMPLES;
    const profileLine: THREE.Vector3[] = [];
    const profileHit: THREE.Vector3[] = [];
    // Vertices were snapped when placed, so they are their own surface point
    const addVertex = (vertex: THREE.Vector3) => {
      profileLine.push(vertex.clone());
      profileHit.push(vertex.clone());
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      addVertex(a);
      const length = a.distanceTo(b);
      for (let d = step; d < length; d += step) {
        if (item.profileRun !== run) {
          return;
        }
        const linePoint = a.clone().lerp(b, d / length);
        const hit = new THREE.Vector3();
        if (await this.#pickBelow(camera, world, linePoint, step, hit)) {
          profileLine.push(linePoint);
          profileHit.push(hit.applyMatrix4(toLocal));
        }
      }
    }
    if (item.profileRun !== run) {
      return;
    }
    addVertex(points.at(-1)!);
    item.profileLine = profileLine;
    item.profileHit = profileHit;
    item.dirty = true;
    this.renderer.queueAnimationFrame();
  }

  /**
   * Find the topmost surface straight below `linePoint` (along the item frame's -z, i.e. gravity in
   * the fixed frame), independent of where the view camera is. `linePoint` is item-local, `world`
   * the item's pose and `out` is in world coordinates; `camera` is moved to look down.
   */
  async #pickBelow(
    camera: THREE.OrthographicCamera,
    world: THREE.Matrix4,
    linePoint: THREE.Vector3,
    step: number,
    out: THREE.Vector3,
  ): Promise<boolean> {
    const { width, height } = this.renderer.input.canvasSize;
    if (width <= 0 || height <= 0) {
      return false;
    }
    // One canvas pixel covers half a sample step, so a point a few pixels wide is caught within
    // about one step of the line
    const perPixel = Math.max(step / 2, 0.005);
    camera.left = (-perPixel * width) / 2;
    camera.right = (perPixel * width) / 2;
    camera.top = (perPixel * height) / 2;
    camera.bottom = (-perPixel * height) / 2;
    camera.near = 0;
    camera.up.set(1, 0, 0).transformDirection(world);
    const target = new THREE.Vector3().copy(linePoint).applyMatrix4(world);
    const center = new THREE.Vector2(width / 2, height / 2);
    for (const lift of PROFILE_LIFTS) {
      camera.far = lift + 1000;
      camera.position.set(linePoint.x, linePoint.y, linePoint.z + lift).applyMatrix4(world);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      // The camera is this run's own and its picks resolve one at a time, so it isn't moved under
      // a pending one
      if (await this.renderer.pickPoint(center, out, camera)) {
        return true;
      }
    }
    return false;
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
    this.#startProfile(draft);
    draft.dirty = true;
    this.#items.push(draft);
    this.select(draft.id);
    this.#cursorDirty = true; // start the next measurement under the cursor
    this.renderer.queueAnimationFrame();
  }

  /** Sample a profile in the background; a failed pick leaves it without one */
  #startProfile(item: Measurement): void {
    void this.#sampleProfile(item).catch(() => undefined);
  }

  /**
   * Run `fn` once the clicks placed so far have landed, unless the draft was replaced or discarded
   * meanwhile or measuring stopped. A draft its last click completed still counts: it's then the
   * selected measurement.
   */
  #afterClicks(fn: () => void): void {
    const draft = this.#draft;
    const session = this.#session;
    this.#clicks = this.#clicks.then(() => {
      if (session === this.#session && (this.#draft === draft || draft?.complete === true)) {
        fn();
      }
    });
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
      unavailable: item.unavailable,
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
    // Place the cursor point where it is now, then add a new point to follow the cursor. Picked
    // now, placed in click order and only into the draft that was clicked.
    this.#updateItem(draft, this.renderer.currentTime);
    const point = new THREE.Vector3();
    const snapped = this.#snapToLocal(cursor.clone(), draft, point).catch(() => false);
    this.#clicks = this.#clicks.then(async () => {
      if (!(await snapped) || this.#draft !== draft) {
        return;
      }
      if (draft.points.length === 0) {
        draft.points.push(new THREE.Vector3());
      }
      const placed = draft.points.at(-1)!;
      // A cursor preview still in flight must not move the placed point
      this.#latestSnap.delete(placed);
      placed.copy(point);
      draft.points.push(placed.clone());
      draft.dirty = true;
      this.renderer.queueAnimationFrame();
      if (draft.points.length - 1 >= KIND_POINTS[draft.kind].max) {
        this.#finishDraft();
      }
    });
  };

  #handleMouseDown = (cursor: THREE.Vector2, _world: unknown, event: MouseEvent): void => {
    if (event.button === 2) {
      this.#rightDown.copy(cursor);
    }
  };

  #handleMouseUp = (cursor: THREE.Vector2, _world: unknown, event: MouseEvent): void => {
    if (event.button === 2 && this.#rightDown.distanceTo(cursor) <= RIGHT_CLICK_SLOP) {
      // Points clicked before finishing still count
      this.#afterClicks(() => {
        this.#finishDraft();
      });
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
      const x = moveEvent.clientX - r.left;
      const y = moveEvent.clientY - r.top;
      // Ignore off-canvas moves so they can't replace a pending in-canvas position
      if (x < 0 || y < 0 || x >= r.width || y >= r.height) {
        return;
      }
      this.#dragCursor.set(x, y);
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
      // Sample the line where the vertex landed, after the last drag snap, unless it was deleted
      void this.#dragSnap.then(() => {
        if (this.#items.includes(hit.item)) {
          this.#startProfile(hit.item);
        }
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  #snapDrag(): void {
    this.#dragPending = false;
    const drag = this.#drag;
    if (drag) {
      this.#dragSnap = this.#snapLatest(this.#dragCursor, drag.item, drag.item.points[drag.index]!);
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
    if (isThreeDeeShortcut("3d.finishMeasurement", event)) {
      // Decide once the clicks so far have landed, so click-then-finish finishes instead of exiting
      this.#afterClicks(() => {
        if ((this.#draft?.points.length ?? 0) > 1) {
          this.#finishDraft();
        } else {
          this.stopMeasuring();
        }
      });
      event.preventDefault();
    } else if (isThreeDeeShortcut("3d.deleteMeasurement", event)) {
      // Decide once the clicks so far have landed, so a just-clicked point is what gets removed
      this.#afterClicks(() => {
        const draft = this.#draft;
        if (draft && draft.points.length > 1) {
          // Remove the last placed point, keeping the one under the cursor
          draft.points.splice(-2, 1);
          draft.dirty = true;
          this.renderer.queueAnimationFrame();
        } else if (this.selectedId != undefined) {
          this.removeMeasurement(this.selectedId);
        }
      });
      event.preventDefault();
    }
  };
}
