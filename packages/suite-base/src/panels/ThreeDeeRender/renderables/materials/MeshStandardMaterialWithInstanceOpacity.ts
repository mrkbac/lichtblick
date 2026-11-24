// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { attribute, materialOpacity } from "three/tsl";
import * as THREE from "three/webgpu";

// Shared by every instance: a node's shader cache key is its id, so a node per material would
// compile a new shader for every entity
const INSTANCE_OPACITY = attribute("instanceOpacity", "float").mul(materialOpacity);

/** MeshStandardNodeMaterial with a per-instance alpha from the geometry's `instanceOpacity` attribute */
export class MeshStandardMaterialWithInstanceOpacity extends THREE.MeshStandardNodeMaterial {
  public constructor(parameters?: THREE.MeshStandardNodeMaterialParameters) {
    super(parameters);
    this.opacityNode = INSTANCE_OPACITY;
  }
}
