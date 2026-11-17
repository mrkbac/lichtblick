// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { produce } from "immer";

import { DEFAULT_PUBLISH_SETTINGS, PublishSettings } from "./PublishSettings";
import type { RendererConfig } from "../IRenderer";
import type { Renderer } from "../Renderer";

function setup() {
  const renderer = {
    config: { publish: { ...DEFAULT_PUBLISH_SETTINGS, poseEstimateXDeviation: 2 } },
    updateConfig(updater: (draft: RendererConfig) => void) {
      this.config = produce(this.config as RendererConfig, updater);
    },
    publishClickTool: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    settings: { setNodesForKey: vi.fn() },
  };
  const extension = new PublishSettings(renderer as unknown as Renderer);
  return { renderer, extension };
}

describe("PublishSettings", () => {
  it("uses the default deviation when the field is cleared instead of publishing NaN", () => {
    // Given
    const { renderer, extension } = setup();
    // When
    extension.handleSettingsAction({
      action: "update",
      payload: { path: ["publish", "poseEstimateXDeviation"], input: "number", value: undefined },
    });
    // Then
    expect(renderer.config.publish.poseEstimateXDeviation).toBe(
      DEFAULT_PUBLISH_SETTINGS.poseEstimateXDeviation,
    );
  });

  it("saves an entered deviation", () => {
    // Given
    const { renderer, extension } = setup();
    // When
    extension.handleSettingsAction({
      action: "update",
      payload: { path: ["publish", "poseEstimateYDeviation"], input: "number", value: 0.1 },
    });
    // Then
    expect(renderer.config.publish.poseEstimateYDeviation).toBe(0.1);
  });
});
