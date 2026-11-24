// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MeshStandardMaterialWithInstanceOpacity } from "./MeshStandardMaterialWithInstanceOpacity";

describe("MeshStandardMaterialWithInstanceOpacity", () => {
  it("shares one compiled shader between instances", () => {
    // A different shader cache key per instance would compile a shader for every entity
    expect(new MeshStandardMaterialWithInstanceOpacity().customProgramCacheKey()).toBe(
      new MeshStandardMaterialWithInstanceOpacity().customProgramCacheKey(),
    );
  });
});
