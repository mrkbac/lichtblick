// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable } from "@lichtblick/suite";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import buildSampleMessage from "./buildSampleMessage";

export type ParsedMessage =
  | { value: Record<string, unknown>; error?: undefined }
  | { value?: undefined; error: string };

/** Parses editor text into a message object, or describes why it is not one. */
export function parseMessageJson(text: string): ParsedMessage {
  if (text.trim().length === 0) {
    return { error: "Enter the message as JSON" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: (err as Error).message };
  }
  if (parsed == undefined || typeof parsed !== "object" || Array.isArray(parsed)) {
    // JSON.parse never returns undefined, so `== undefined` means null here
    const kind = parsed == undefined ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed;
    return { error: `Message must be a JSON object, not ${kind}` };
  }
  return { value: parsed as Record<string, unknown> };
}

/** Pretty JSON that also handles bigint values (e.g. 64-bit integers in service responses). */
export function stringifyMessage(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2) ?? ""
  );
}

/** JSON template for a schema, or undefined if the schema is unknown. */
export function sampleMessageJson(
  datatypes: Immutable<RosDatatypes>,
  schemaName: string | undefined,
): string | undefined {
  if (schemaName == undefined || !datatypes.has(schemaName)) {
    return undefined;
  }
  return stringifyMessage(buildSampleMessage(datatypes, schemaName));
}

/**
 * True if the text contains user edits worth keeping, i.e. it is not empty, not `{}` and not the
 * untouched template of `schemaName`.
 */
export function isEditedMessage(
  text: string | undefined,
  datatypes: Immutable<RosDatatypes>,
  schemaName: string | undefined,
): boolean {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "" || trimmed === "{}") {
    return false;
  }
  const sample = sampleMessageJson(datatypes, schemaName);
  if (sample == undefined) {
    return true;
  }
  const parsed = parseMessageJson(trimmed);
  return parsed.value == undefined || stringifyMessage(parsed.value) !== sample;
}
