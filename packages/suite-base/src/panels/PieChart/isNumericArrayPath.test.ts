// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinition } from "@foxglove/message-definition";

import { isNumericArrayPath } from "./isNumericArrayPath";

const schemas: Record<string, MessageDefinition> = {
  "pkg/Root": {
    definitions: [
      { name: "values", type: "float32", isArray: true },
      { name: "doubles", type: "float64", isArray: true },
      { name: "counts", type: "uint32", isArray: true },
      { name: "names", type: "string", isArray: true },
      { name: "scalar", type: "float32" },
      { name: "inner", type: "pkg/Inner", isComplex: true },
      { name: "items", type: "pkg/Inner", isComplex: true, isArray: true },
    ],
  },
  "pkg/Inner": { definitions: [{ name: "values", type: "float32", isArray: true }] },
};
const getSchema = (name: string) => schemas[name];
const getTopicSchema = (topic: string) => (topic === "/t" ? schemas["pkg/Root"] : undefined);
const check = (path: string) => isNumericArrayPath(path, getTopicSchema, getSchema);

describe("isNumericArrayPath", () => {
  it("accepts numeric array fields, nested ones too", () => {
    expect(check("/t.values")).toBe(true);
    expect(check("/t.doubles")).toBe(true);
    expect(check("/t.counts")).toBe(true);
    expect(check("/t.inner.values")).toBe(true);
  });

  it("rejects everything the pie chart can't show", () => {
    expect(check("/t")).toBe(false);
    expect(check("/t.scalar")).toBe(false);
    expect(check("/t.names")).toBe(false);
    expect(check("/t.items[:].values")).toBe(false);
    expect(check("/unknown.values")).toBe(false);
  });
});
