// SPDX-License-Identifier: MPL-2.0

import { messagePathStructures } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import { plottableFields, resolvePlotPaths } from "./plottableFields";

const datatypes: RosDatatypes = new Map([
  [
    "example/Imu",
    {
      definitions: [
        { name: "header", type: "std_msgs/Header", isComplex: true },
        { name: "linear_acceleration", type: "example/Vector3", isComplex: true },
        { name: "covariance", type: "float64", isArray: true },
        { name: "frame", type: "string" },
      ],
    },
  ],
  [
    "std_msgs/Header",
    {
      definitions: [
        { name: "seq", type: "uint32" },
        { name: "frame_id", type: "string" },
      ],
    },
  ],
  [
    "example/Vector3",
    {
      definitions: [
        { name: "x", type: "float64" },
        { name: "y", type: "float64" },
        { name: "z", type: "float64" },
      ],
    },
  ],
]);
const topics = [{ name: "/imu", schemaName: "example/Imu" }];
const structures = messagePathStructures(datatypes);

describe("plottableFields", () => {
  it.each<[string, string[] | undefined]>([
    [
      "/imu.linear_acceleration",
      ["/imu.linear_acceleration.x", "/imu.linear_acceleration.y", "/imu.linear_acceleration.z"],
    ],
    // A whole message skips its header, arrays and strings
    [
      "/imu",
      ["/imu.linear_acceleration.x", "/imu.linear_acceleration.y", "/imu.linear_acceleration.z"],
    ],
    ["/imu.linear_acceleration.x", undefined],
    ["/imu.nope", undefined],
    ["/missing.x", undefined],
    ["", undefined],
  ])("%s", (path, expected) => {
    expect(plottableFields(path, structures, topics)).toEqual(expected);
  });
});

describe("resolvePlotPaths", () => {
  it.each<[string, string[] | undefined]>([
    ["/imu.linear_acceleration.x", ["/imu.linear_acceleration.x"]],
    [
      "/imu.linear_acceleration",
      ["/imu.linear_acceleration.x", "/imu.linear_acceleration.y", "/imu.linear_acceleration.z"],
    ],
    [".5", [".5"]],
    ["1e+3", ["1e+3"]],
    ["/imu.linear_acceleration.x.@abs", ["/imu.linear_acceleration.x.@abs"]],
    // Incomplete, invalid, or not plottable
    ["/imu.", undefined],
    ["/imu.nope", undefined],
    // Plot accepts string fields like its settings do
    ["/imu.frame", ["/imu.frame"]],
    ["", undefined],
  ])("%s", (path, expected) => {
    expect(resolvePlotPaths(path, structures, topics)).toEqual(expected);
  });
});
