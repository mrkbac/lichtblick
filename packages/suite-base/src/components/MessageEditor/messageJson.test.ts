// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import {
  isEditedMessage,
  parseMessageJson,
  sampleMessageJson,
  stringifyMessage,
} from "./messageJson";

const datatypes: RosDatatypes = new Map([
  ["pkg/Msg", { definitions: [{ name: "data", type: "int32" }] }],
]);

describe("parseMessageJson", () => {
  it.each([
    ["", "Enter the message as JSON"],
    ["[]", "Message must be a JSON object, not an array"],
    ["null", "Message must be a JSON object, not null"],
    ["3", "Message must be a JSON object, not number"],
  ])("rejects %j", (text, error) => {
    expect(parseMessageJson(text)).toEqual({ error });
  });

  it("reports JSON syntax errors", () => {
    expect(parseMessageJson("{").error).toBeDefined();
  });

  it("parses objects", () => {
    expect(parseMessageJson('{"a": 1}')).toEqual({ value: { a: 1 } });
  });
});

describe("stringifyMessage", () => {
  it("formats bigints as strings", () => {
    expect(stringifyMessage({ a: 1n })).toBe('{\n  "a": "1"\n}');
  });
});

describe("isEditedMessage", () => {
  const template = sampleMessageJson(datatypes, "pkg/Msg");

  it("treats empty and untouched templates as unedited", () => {
    expect(template).toBe('{\n  "data": 0\n}');
    expect(isEditedMessage(undefined, datatypes, "pkg/Msg")).toBe(false);
    expect(isEditedMessage(" {} ", datatypes, "pkg/Msg")).toBe(false);
    expect(isEditedMessage(template, datatypes, "pkg/Msg")).toBe(false);
    expect(isEditedMessage('{"data":0}', datatypes, "pkg/Msg")).toBe(false);
  });

  it("detects edits", () => {
    expect(isEditedMessage('{"data": 1}', datatypes, "pkg/Msg")).toBe(true);
    expect(isEditedMessage("{invalid", datatypes, "pkg/Msg")).toBe(true);
    expect(isEditedMessage('{"data": 0}', datatypes, undefined)).toBe(true);
  });
});
