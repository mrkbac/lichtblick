// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Locator, Page } from "@playwright/test";

export class PlayerControls {
  public constructor(private readonly page: Page) {}

  public async play(): Promise<void> {
    await this.getPlayButton().click();
  }

  public async getTimestampText(): Promise<string> {
    return await this.getTimestampInput().inputValue();
  }

  public getPlayButton(): Locator {
    return this.page.getByTestId("play-button");
  }

  public getTimestampInput(): Locator {
    return this.page.getByTestId("PlaybackTime-text").locator("input");
  }

  public getSlider(): Locator {
    return this.page.getByTestId("playback-slider");
  }

  public getProgressPlot(): Locator {
    return this.page.getByTestId("progress-plot");
  }
}
