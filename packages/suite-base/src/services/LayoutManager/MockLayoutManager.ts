// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Mock } from "vitest";

import { ILayoutManager, LayoutFavorites } from "@lichtblick/suite-base/services/ILayoutManager";

export default class MockLayoutManager implements ILayoutManager {
  public supportsSharing = false;
  public isBusy: Mock = vi.fn().mockReturnValue(false);
  public isOnline = false;
  public error: Error | undefined = undefined;
  public favorites: LayoutFavorites = { personal: new Set(), shared: new Set() };

  public on: Mock = vi.fn();
  public off: Mock = vi.fn();
  public setError: Mock = vi.fn();
  public setOnline: Mock = vi.fn();
  public getLayouts: Mock = vi.fn().mockResolvedValue([]);
  public getLayout: Mock = vi.fn();
  public saveNewLayout: Mock = vi.fn();
  public updateLayout: Mock = vi.fn();
  public deleteLayout: Mock = vi.fn();
  public overwriteLayout: Mock = vi.fn();
  public revertLayout: Mock = vi.fn();
  public makePersonalCopy: Mock = vi.fn();
  public syncWithRemote: Mock = vi.fn();
  public loadFavorites: Mock = vi.fn(async () => await Promise.resolve(this.favorites));
  public canFavorite: Mock = vi.fn().mockReturnValue(false);
  public setFavorite: Mock = vi.fn().mockResolvedValue(undefined);
}
