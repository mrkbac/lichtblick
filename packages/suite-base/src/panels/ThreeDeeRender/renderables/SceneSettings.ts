// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { SettingsTreeAction } from "@lichtblick/suite";

import type { Renderer } from "../Renderer";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { DEFAULT_LABEL_SCALE_FACTOR } from "../defaults";
import { sceneSettingsNode } from "../settingsNodes/global";

export class SceneSettings extends SceneExtension {
  public static extensionId = "foxglove.SceneSettings";
  public constructor(renderer: Renderer) {
    super(SceneSettings.extensionId, renderer);

    renderer.labelPool.scaleFactor =
      renderer.config.scene.labelScaleFactor ?? DEFAULT_LABEL_SCALE_FACTOR;
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const node = sceneSettingsNode(this.renderer.config.scene, {
      debugPicking: this.renderer.debugPicking,
      loaded: this.renderer.modelCache.options,
    });
    return [{ path: ["scene"], node: { ...node, handler: this.handleSettingsAction } }];
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    if (action.action === "perform-node-action" && action.payload.id === "reset-scene") {
      this.renderer.updateConfig((draft) => {
        draft.scene = {};
      });
      this.renderer.labelPool.setScaleFactor(DEFAULT_LABEL_SCALE_FACTOR);
      this.renderer.setColorScheme(this.renderer.colorScheme, undefined);
      this.renderer.updateSceneRenderSettings();
      this.updateSettingsTree();
      return;
    }

    if (action.action !== "update" || action.payload.path.length === 0) {
      return;
    }

    const path = action.payload.path;
    const category = path[0]!;
    const value = action.payload.value;
    if (category === "scene") {
      if (path[1] === "debugPicking") {
        this.renderer.debugPicking = (value as boolean | undefined) ?? false;
        this.updateSettingsTree();
        return;
      }
      // Update the configuration
      this.renderer.updateConfig((draft) => _.set(draft, path, value));

      if (path[1] === "backgroundColor") {
        const backgroundColor = value as string | undefined;
        this.renderer.setColorScheme(this.renderer.colorScheme, backgroundColor);
      } else if (path[1] === "labelScaleFactor") {
        const labelScaleFactor = value as number | undefined;
        this.renderer.labelPool.setScaleFactor(labelScaleFactor ?? DEFAULT_LABEL_SCALE_FACTOR);
      } else if (
        path[1] === "mainLightMode" ||
        path[1] === "directionalLightIntensity" ||
        path[1] === "hemisphereLightIntensity"
      ) {
        this.renderer.updateSceneRenderSettings();
      }
    } else {
      return;
    }

    // Update the settings sidebar
    this.updateSettingsTree();
  };
}
