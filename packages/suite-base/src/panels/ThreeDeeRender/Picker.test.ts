// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { decodePick } from "./Picker";

function floatBits(value: number): number {
  return new Uint32Array(new Float32Array([value]).buffer)[0]!;
}

describe("decodePick", () => {
  it("reads nothing from a cleared pixel", () => {
    expect(decodePick([0, 0, 0, 0])).toBeUndefined();
  });

  it("reads object, instance and view depth", () => {
    expect(decodePick([42, 7, floatBits(12.5), 1])).toEqual({
      objectId: 42,
      instanceIndex: 7,
      viewDepth: 12.5,
    });
  });

  it("reads objects without instances", () => {
    expect(decodePick([0, 0xffffffff, floatBits(3), 1])).toEqual({
      objectId: 0,
      instanceIndex: undefined,
      viewDepth: 3,
    });
  });
});
