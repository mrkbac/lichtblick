// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Page } from "@playwright/test";

export class Sidebar {
  public constructor(private readonly page: Page) {}

  public async openLayoutsTab(): Promise<void> {
    await this.page.getByTestId("layouts-left").click();
  }
}
