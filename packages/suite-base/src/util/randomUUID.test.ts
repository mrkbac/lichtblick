// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { randomUUID } from "./randomUUID";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUUID", () => {
  it.each([true, false])("returns distinct v4 UUIDs when isSecureContext is %s", (secure) => {
    vi.stubGlobal("isSecureContext", secure);
    const ids = new Set(Array.from({ length: 100 }, () => randomUUID()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(UUID_V4);
    }
    vi.unstubAllGlobals();
  });
});
