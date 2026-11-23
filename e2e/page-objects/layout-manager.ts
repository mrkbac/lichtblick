// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Locator, Page } from "@playwright/test";

export class LayoutManager {
  public constructor(private readonly page: Page) {}

  public async selectPanel(panelName: string): Promise<void> {
    await this.page.getByTestId(`panel-grid-card ${panelName}`).click();
  }

  public getCreateNewLayoutButton(): Locator {
    return this.page.getByTestId("create-new-layout");
  }
}
