// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { rosapiTypeDefsToDatatypes } from "./rosapiTypeDefs";

describe("rosapiTypeDefsToDatatypes", () => {
  it("converts nested, array and IDL primitive fields", () => {
    const datatypes = rosapiTypeDefsToDatatypes([
      {
        type: "pkg/DoThing_Request",
        fieldnames: ["flag", "values", "pose", "name"],
        fieldtypes: ["boolean", "double", "geometry_msgs/Pose", "string<=10"],
        fieldarraylen: [-1, 3, 0, -1],
      },
      {
        type: "geometry_msgs/Pose",
        fieldnames: ["x"],
        fieldtypes: ["float64"],
        fieldarraylen: [-1],
      },
    ]);
    expect(datatypes.get("pkg/DoThing_Request")?.definitions).toEqual([
      { name: "flag", type: "bool", isComplex: false, isArray: false, arrayLength: undefined },
      { name: "values", type: "float64", isComplex: false, isArray: true, arrayLength: 3 },
      {
        name: "pose",
        type: "geometry_msgs/Pose",
        isComplex: true,
        isArray: true,
        arrayLength: undefined,
      },
      { name: "name", type: "string", isComplex: false, isArray: false, arrayLength: undefined },
    ]);
    expect(datatypes.has("geometry_msgs/Pose")).toBe(true);
  });
});
