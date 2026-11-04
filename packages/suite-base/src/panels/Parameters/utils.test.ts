// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ParameterValue } from "@lichtblick/suite";

import {
  allGroupKeys,
  buildRows,
  diffParameters,
  formatValue,
  hexToBytes,
  makeMatcher,
  parameterType,
  parametersFromYaml,
  parametersToYaml,
} from "./utils";

const rowsText = (rows: ReturnType<typeof buildRows>) =>
  rows.map(
    (r) => `${"  ".repeat(r.depth)}${r.kind === "group" ? `${r.label}/ (${r.count})` : r.label}`,
  );

describe("parameterType", () => {
  it.each<[ParameterValue, string]>([
    [undefined, "unset"],
    [true, "bool"],
    [3, "int"],
    [3.5, "float"],
    ["a", "string"],
    [new Uint8Array([1]), "bytes"],
    [new Date(0), "time"],
    [[1], "list"],
    [{ a: 1 }, "dict"],
  ])("%p is %s", (value, type) => {
    expect(parameterType(value)).toBe(type);
  });
});

describe("hex bytes", () => {
  it("round-trips", () => {
    const bytes = new Uint8Array([0, 15, 255]);
    expect(formatValue(bytes)).toBe("00 0f ff");
    expect(hexToBytes("00 0f ff")).toEqual(bytes);
    expect(hexToBytes("000fFF")).toEqual(bytes);
  });

  it("rejects invalid input", () => {
    expect(hexToBytes("0")).toBeUndefined();
    expect(hexToBytes("zz")).toBeUndefined();
  });
});

describe("buildRows", () => {
  const names = [
    "/robot/arm/joint_10/gain",
    "/robot/arm/joint_2/gain",
    "/robot/use_sim_time",
    "/rosdistro",
    "camera_node.exposure.auto",
    "camera_node.exposure.value",
  ];

  it("groups by / and ., namespaces first, natural sort, merges single-child chains", () => {
    expect(rowsText(buildRows(names, { tree: true, collapsed: new Set() }))).toEqual([
      "camera_node.exposure/ (2)",
      "  auto",
      "  value",
      "robot/ (3)",
      "  arm/ (2)",
      "    joint_2/ (1)",
      "      gain",
      "    joint_10/ (1)",
      "      gain",
      "  use_sim_time",
      "rosdistro",
    ]);
  });

  it("is independent of input order", () => {
    const shuffled = [...names].reverse();
    expect(buildRows(shuffled, { tree: true, collapsed: new Set() })).toEqual(
      buildRows(names, { tree: true, collapsed: new Set() }),
    );
  });

  it("hides children of collapsed groups", () => {
    const rows = buildRows(names, {
      tree: true,
      collapsed: new Set(["/robot"]),
    });
    expect(rowsText(rows)).toEqual([
      "camera_node.exposure/ (2)",
      "  auto",
      "  value",
      "robot/ (3)",
      "rosdistro",
    ]);
    expect(allGroupKeys(names)).toEqual(
      expect.arrayContaining(["/robot", "/robot/arm", "camera_node.exposure"]),
    );
  });

  it("handles a name that is both a parameter and a namespace", () => {
    expect(rowsText(buildRows(["a", "a.b"], { tree: true, collapsed: new Set() }))).toEqual([
      "a",
      "a/ (1)",
      "  b",
    ]);
  });

  it("keeps a parameter that is also a namespace inside a merged chain", () => {
    expect(rowsText(buildRows(["/a/b", "/a/b/c"], { tree: true, collapsed: new Set() }))).toEqual([
      "a/ (2)",
      "  b",
      "  b/ (1)",
      "    c",
    ]);
  });

  it("returns a sorted flat list", () => {
    expect(rowsText(buildRows(["b", "a/x"], { tree: false, collapsed: new Set() }))).toEqual([
      "a/x",
      "b",
    ]);
  });

  it("handles thousands of parameters quickly", () => {
    const many = Array.from({ length: 20_000 }, (_, i) => `/node_${i % 100}/group_${i % 7}/p_${i}`);
    const start = performance.now();
    const rows = buildRows(many, { tree: true, collapsed: new Set() });
    expect(rows.length).toBe(20_000 + 100 + 700);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("makeMatcher", () => {
  it("matches substrings case-insensitively", () => {
    const match = makeMatcher("GAIN", { regex: false }) as (name: string) => boolean;
    expect(match("/arm/gain")).toBe(true);
    expect(match("/arm/speed")).toBe(false);
  });

  it("supports regex and reports invalid ones", () => {
    const match = makeMatcher("^/arm/.*_\\d$", { regex: true }) as (name: string) => boolean;
    expect(match("/arm/joint_1")).toBe(true);
    expect(match("/arm/joint_10")).toBe(false);
    expect(makeMatcher("(", { regex: true })).toBeInstanceOf(Error);
  });
});

describe("snapshots", () => {
  const params = new Map<string, ParameterValue>([
    ["/b/bytes", new Uint8Array([0, 0xff, 0x80])],
    ["/a/num", 1.5],
    ["/a/flag", true],
    ["/a/list", [1, "two", { three: 3 }]],
    ["/a/time", new Date(1618876820517)],
    ["/a/unset", undefined],
  ]);

  it("round-trips through YAML including non-UTF-8 bytes", () => {
    const yaml = parametersToYaml(params);
    expect(yaml.indexOf("/a/flag")).toBeLessThan(yaml.indexOf("/b/bytes"));
    const parsed = parametersFromYaml(yaml);
    expect(parsed.get("/b/bytes")).toBeInstanceOf(Uint8Array);
    expect(diffParameters(params, parsed)).toEqual(new Map());
  });

  it("rejects YAML that isn't a map", () => {
    expect(() => parametersFromYaml("- a\n- b")).toThrow();
    expect(parametersFromYaml("")).toEqual(new Map());
  });

  it("diffs added, removed and changed parameters", () => {
    const current = new Map<string, ParameterValue>([
      ["same", 1],
      ["changed", 2],
      ["added", 3],
      ["bytes", new Uint8Array([1])],
    ]);
    const snapshot = new Map<string, ParameterValue>([
      ["same", 1],
      ["changed", 1],
      ["removed", 4],
      ["bytes", new Uint8Array([1])],
    ]);
    expect(diffParameters(current, snapshot)).toEqual(
      new Map([
        ["changed", "changed"],
        ["added", "added"],
        ["removed", "removed"],
      ]),
    );
  });
});
