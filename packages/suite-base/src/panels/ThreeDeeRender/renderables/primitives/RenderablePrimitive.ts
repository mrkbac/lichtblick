// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SceneEntity } from "@foxglove/schemas";
import type * as THREE from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";

import { BaseUserData, Renderable } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderable";
import type { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { RosValue } from "@lichtblick/suite-base/players/types";
import { emptyPose } from "@lichtblick/suite-base/util/Pose";

import type { LineMaterialWithAlphaVertex } from "../../LineMaterialWithAlphaVertex";
import { LayerSettingsEntity } from "../../settings";

/** An instanced mesh a batch can draw, with the shared shape its own geometry was cloned from */
export type InstancedPart = {
  mesh: THREE.InstancedMesh;
  outline: THREE.LineSegments | undefined;
  shape: { geometry: THREE.BufferGeometry; edges: THREE.BufferGeometry | undefined };
};

/** A line a batch can draw; `parent` holds its pose within the primitive */
export type LinePart = {
  line: LineSegments2;
  material: LineMaterialWithAlphaVertex;
  parent: THREE.Object3D;
};

export type EntityRenderableUserData = BaseUserData & {
  topic?: string;
  entity?: SceneEntity;
  entityId?: string;
  expiresAt?: bigint;
  settings?: LayerSettingsEntity;
};

const PRIMITIVE_DEFAULT_SETTINGS: LayerSettingsEntity = {
  showOutlines: true,
  visible: false,
  color: undefined,
  selectedIdVariable: undefined,
};
export class RenderablePrimitive extends Renderable<EntityRenderableUserData> {
  public constructor(
    name: string,
    renderer: Renderer,
    userData: EntityRenderableUserData = {
      receiveTime: -1n,
      messageTime: -1n,
      frameId: "",
      pose: emptyPose(),
      settings: PRIMITIVE_DEFAULT_SETTINGS,
      settingsPath: [],
      entity: undefined,
    },
  ) {
    super(name, renderer, userData);
  }
  public update(
    topic: string | undefined,
    entity: SceneEntity | undefined,
    settings: LayerSettingsEntity,
    receiveTime: bigint,
  ): void {
    this.userData.topic = topic;
    this.userData.entity = entity;
    this.userData.settings = settings;
    this.userData.receiveTime = receiveTime;
  }

  public override idFromMessage(): number | string | undefined {
    return this.userData.entity?.id;
  }

  public override selectedIdVariable(): string | undefined {
    const settings = this.getSettings();
    return settings?.selectedIdVariable;
  }

  public getSettings(): LayerSettingsEntity | undefined {
    if (this.userData.topic == undefined) {
      return undefined;
    }
    return this.userData.settings;
  }

  public override details(): Record<string, RosValue> {
    return this.userData.entity ?? {};
  }

  public setColorScheme(colorScheme: "dark" | "light"): void {
    void colorScheme;
  }

  /** Instanced meshes, children of this object, that a batch may draw instead */
  public instancedParts(): readonly InstancedPart[] {
    return [];
  }

  /** Lines, in their parent's space, that a batch may draw instead */
  public lineParts(): readonly LinePart[] {
    return [];
  }

  public prepareForReuse(): void {
    this.userData.entity = undefined;
    this.userData.pose = emptyPose();
  }

  public addError(errorId: string, message: string): void {
    this.renderer.settings.errors.add(this.userData.settingsPath, errorId, message);
  }

  public clearErrors(): void {
    // presumably a renderable has not been assigned a settings path if it is 0
    // running clearPath([]) will clear all errors from the settings tree
    if (this.userData.settingsPath.length > 0) {
      this.renderer.settings.errors.clearPath(this.userData.settingsPath);
    }
  }
}
