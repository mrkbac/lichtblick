// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import { messagePathStructures } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";

import { Schema, compileRows, subscriptionsFor } from "./compile";

const datatypes: RosDatatypes = new Map([
  [
    "example/State",
    {
      definitions: [
        { name: "IDLE", type: "uint8", isConstant: true, value: 0 },
        { name: "MOVING", type: "uint8", isConstant: true, value: 1 },
        { name: "mode", type: "uint8" },
        { name: "speed", type: "float64" },
      ],
    },
  ],
]);

const schema: Schema = {
  structures: messagePathStructures(datatypes),
  enumValues: enumValuesByDatatypeAndField(datatypes),
  schemaNames: new Map([["/state", "example/State"]]),
};

describe("compileRows", () => {
  it("parses paths, fills in variables and flags invalid ones", () => {
    const { compiled, invalid } = compileRows(
      [
        { id: "a", path: "/state.speed.@mul($k)" },
        { id: "b", path: "/state.." },
        { id: "c", path: "" },
      ],
      { k: 3 },
      schema,
    );
    expect(compiled.map((row) => row.id)).toEqual(["a"]);
    expect(compiled[0]!.path.messagePath.at(-1)).toMatchObject({
      type: "modifier",
      args: [3],
    });
    expect([...invalid]).toEqual(["b"]);
    // The parser logs the invalid path
    (console.error as Mock).mockClear();
  });

  it("changes the key when a variable changes", () => {
    const rows = [{ id: "a", path: "/state.speed.@mul($k)" }];
    const first = compileRows(rows, { k: 1 }, schema).compiled[0]!.key;
    expect(compileRows(rows, { k: 1 }, schema).compiled[0]!.key).toBe(first);
    expect(compileRows(rows, { k: 2 }, schema).compiled[0]!.key).not.toBe(first);
  });

  it("keys paths with numeric filters", () => {
    const key = (path: string, vars = {}) =>
      compileRows([{ id: "a", path }], vars, schema).compiled[0]!.key;
    const numeric = key("/state{mode==1}.speed");
    expect(numeric).toBe(key("/state{mode==1}.speed"));
    expect(numeric).not.toBe(key("/state{mode==2}.speed"));
    expect(numeric).not.toBe(key("/state{mode==$k}.speed", { k: 1 }));
    expect(numeric).not.toBe(key('/state{mode=="1n"}.speed'));
  });

  it("finds enum names for the field a path ends on", () => {
    const { enumNames } = compileRows(
      [
        { id: "a", path: "/state.mode" },
        { id: "b", path: "/state.speed" },
        { id: "c", path: "/state.mode.@abs" },
      ],
      {},
      schema,
    );
    expect(enumNames.get("a")).toEqual({ 0: "IDLE", 1: "MOVING" });
    expect(enumNames.has("b")).toBe(false);
    expect(enumNames.has("c")).toBe(false);
  });
});

describe("subscriptionsFor", () => {
  const subs = (paths: string[]) =>
    subscriptionsFor(
      compileRows(
        paths.map((path, i) => ({ id: String(i), path })),
        {},
        schema,
      ).compiled,
    );

  it("subscribes once per topic with the union of fields", () => {
    expect(subs(["/a.x", "/a.y.z", "/b.x", "/a.x"])).toEqual([
      { topic: "/a", preloadType: "partial", fields: ["header", "x", "y"] },
      { topic: "/b", preloadType: "partial", fields: ["header", "x"] },
    ]);
  });

  it("subscribes to whole messages when a row needs them", () => {
    expect(subs(["/a.x", "/a"])).toEqual([{ topic: "/a", preloadType: "partial" }]);
    expect(subs(["/a", "/a.x"])).toEqual([{ topic: "/a", preloadType: "partial" }]);
  });
});
