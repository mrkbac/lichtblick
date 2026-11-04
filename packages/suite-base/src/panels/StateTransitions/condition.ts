// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessagePathFilter } from "@lichtblick/message-path";
import { filterMatches } from "@lichtblick/suite-base/components/MessagePathSyntax/filterMatches";

import { ValidQueriedDataValue } from "./types";

const CONDITION_RE = /^\s*(==|!=|<=|>=|<|>)\s*(\S.*?)\s*$/;
// A quoted string, or a single bare token (number, true/false or an unquoted word).
const LITERAL_RE = /^(?:"([^"]*)"|'([^']*)'|([^\s"'<>=!]+))$/;

/**
 * Parses a single comparison like `> 2`, `== "ERROR"` or `!= true` into a message path filter
 * (the same thing `{field==value}` filters produce), so it can be evaluated with filterMatches.
 * Returns undefined for anything else.
 */
export function parseCondition(input: string | undefined): MessagePathFilter | undefined {
  const match = CONDITION_RE.exec(input ?? "");
  if (!match) {
    return undefined;
  }
  const [, operator, literal] = match as unknown as [string, MessagePathFilter["operator"], string];
  const value = parseLiteral(literal);
  if (value == undefined) {
    return undefined;
  }
  return {
    type: "filter",
    path: [],
    operator,
    value,
    nameLoc: 0,
    valueLoc: 0,
    repr: `${operator} ${literal}`,
  };
}

function parseLiteral(literal: string): number | bigint | string | undefined {
  const parts = LITERAL_RE.exec(literal);
  if (!parts) {
    return undefined;
  }
  const quoted = parts[1] ?? parts[2];
  if (quoted != undefined) {
    return quoted;
  }
  // Booleans compare loosely against 1/0, the same way filters treat them.
  if (literal === "true" || literal === "false") {
    return literal === "true" ? 1 : 0;
  }
  const number = Number(literal);
  // Integers beyond 2^53 stay exact as bigint so 64-bit values compare correctly.
  if (/^-?\d+$/.test(literal) && !Number.isSafeInteger(number)) {
    return BigInt(literal);
  }
  return Number.isFinite(number) ? number : literal;
}

/**
 * String literals are also compared against the constant name, so `== ERROR` works on ROS enum
 * constants while `== 3` (or `== "3"`) still matches the raw value.
 */
export function conditionMatches(
  condition: MessagePathFilter,
  value: ValidQueriedDataValue,
  constantName: string | undefined,
): boolean {
  const matchesValue = filterMatches(condition, value);
  if (typeof condition.value !== "string" || constantName == undefined) {
    return matchesValue;
  }
  const matchesName = filterMatches(condition, constantName);
  return condition.operator === "!=" ? matchesValue && matchesName : matchesValue || matchesName;
}
