// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { parseMessagePath } from "@lichtblick/message-path";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";

import { filterMatches } from "./filterMatches";
import { messagePathStructures } from "./messagePathsForDatatype";
import { resolveEnumNamesInPath } from "./resolveEnumNames";
import { simpleGetMessagePathDataItems } from "./simpleGetMessagePathDataItems";

const datatypes: RosDatatypes = new Map([
  [
    "robot",
    {
      definitions: [
        { name: "IDLE", type: "uint8", isConstant: true, value: 0 },
        { name: "MOVING", type: "uint8", isConstant: true, value: 2 },
        { name: "status", type: "uint8" },
        { name: "name", type: "string" },
        { name: "arms", type: "arm", isArray: true, isComplex: true },
      ],
    },
  ],
  [
    "arm",
    {
      definitions: [
        { name: "OPEN", type: "int32", isConstant: true, value: 5 },
        { name: "gripper", type: "int32" },
        { name: "id", type: "int32" },
      ],
    },
  ],
]);

function query(path: string, message: unknown): unknown[] {
  const resolved = resolveEnumNamesInPath(
    parseMessagePath(path)!,
    messagePathStructures(datatypes),
    enumValuesByDatatypeAndField(datatypes),
    "robot",
  );
  return simpleGetMessagePathDataItems(
    { topic: "/robot", schemaName: "robot", receiveTime: { sec: 0, nsec: 0 }, sizeInBytes: 0, message },
    resolved,
  );
}

describe("resolveEnumNamesInPath", () => {
  const message = {
    status: 2,
    name: "MOVING",
    arms: [
      { gripper: 5, id: 1 },
      { gripper: 0, id: 2 },
    ],
  };

  it("matches enum names like their values", () => {
    expect(query("/robot{status==MOVING}.status", message)).toEqual([2]);
    expect(query("/robot{status==2}.status", message)).toEqual([2]);
    expect(query("/robot{status!=IDLE}.status", message)).toEqual([2]);
    expect(query("/robot{status==IDLE}.status", message)).toEqual([]);
  });

  it("resolves enum names of nested and array element types", () => {
    expect(query("/robot.arms[:]{gripper==OPEN}.id", message)).toEqual([1]);
  });

  it("matches nothing for unknown names and never treats quoted strings as enums", () => {
    expect(query("/robot{status==STOPPED}.status", message)).toEqual([]);
    expect(query("/robot{name==MOVING}.status", message)).toEqual([]);
    expect(query('/robot{name=="MOVING"}.status', message)).toEqual([2]);
  });

  it("matches nothing when the enum name was never resolved", () => {
    const filter = parseMessagePath("/robot{status==MOVING}")!.messagePath[0]!;
    expect(filter.type === "filter" && filterMatches(filter, { status: 2 })).toBe(false);
  });
});
