// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { SettingsTreeAction } from "@lichtblick/suite";

import { PublishClickType } from "./PublishClickTool";
import type { Renderer } from "../Renderer";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { DEFAULT_PUBLISH_SETTINGS } from "../defaults";
import { publishSettingsNode } from "../settingsNodes/global";

export { DEFAULT_PUBLISH_SETTINGS };

export class PublishSettings extends SceneExtension {
  public static extensionId = "foxglove.PublishSettings";
  public constructor(renderer: Renderer, name: string = PublishSettings.extensionId) {
    super(name, renderer);

    renderer.publishClickTool.addEventListener(
      "foxglove.publish-type-change",
      this.#handlePublishToolChange,
    );
  }

  public override dispose(): void {
    this.renderer.publishClickTool.removeEventListener(
      "foxglove.publish-type-change",
      this.#handlePublishToolChange,
    );
    super.dispose();
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const node = publishSettingsNode(this.renderer.config.publish);
    return [{ path: ["publish"], node: { ...node, handler: this.handleSettingsAction } }];
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    if (action.action !== "update" || action.payload.path.length === 0) {
      return;
    }

    const path = action.payload.path;
    const category = path[0]!;
    const value = action.payload.value;
    if (category === "publish") {
      // Update the configuration
      if (path[1] === "topic") {
        this.renderer.updateConfig((draft) => {
          switch (draft.publish.type) {
            case "point":
              draft.publish.pointTopic =
                (value as string | undefined) ?? DEFAULT_PUBLISH_SETTINGS.pointTopic;
              break;
            case "pose":
              draft.publish.poseTopic =
                (value as string | undefined) ?? DEFAULT_PUBLISH_SETTINGS.poseTopic;
              break;
            case "pose_estimate":
              draft.publish.poseEstimateTopic =
                (value as string | undefined) ?? DEFAULT_PUBLISH_SETTINGS.poseEstimateTopic;
              break;
          }
        });
      } else if (path[1] === "type") {
        // ThreeDeeRender will update the config based on this change
        if (this.renderer.publishClickTool.publishClickType !== value) {
          this.renderer.publishClickTool.setPublishClickType(value as PublishClickType);
          this.renderer.publishClickTool.stop();
        }
      } else {
        this.renderer.updateConfig((draft) => _.set(draft, path, value));
      }
    } else {
      return;
    }

    // Update the settings sidebar
    this.updateSettingsTree();
  };

  #handlePublishToolChange = (): void => {
    this.renderer.updateConfig((draft) => {
      draft.publish.type = this.renderer.publishClickTool.publishClickType;
      return draft;
    });
    this.updateSettingsTree();
  };
}
