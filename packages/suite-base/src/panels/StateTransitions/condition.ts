// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessagePathFilter } from "@lichtblick/message-path";
import { filterMatches } from "@lichtblick/suite-base/components/MessagePathSyntax/filterMatches";

import { ValidQueriedDataValue } from "./types";

const CONDITION_RE = /^\s*(==|!=|<=|>=|<|>)\s*(\S.*?)\s*$/;
const QUOTED_RE = /^(["'])(.*)\1$/;

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
  return {
    type: "filter",
    path: [],
    operator,
    value: parseLiteral(literal),
    nameLoc: 0,
    valueLoc: 0,
    repr: `${operator} ${literal}`,
  };
}

function parseLiteral(literal: string): number | string {
  const quoted = QUOTED_RE.exec(literal);
  if (quoted) {
    return quoted[2]!;
  }
  // Booleans compare loosely against 1/0, the same way filters treat them.
  if (literal === "true" || literal === "false") {
    return literal === "true" ? 1 : 0;
  }
  const number = Number(literal);
  return Number.isFinite(number) ? number : literal;
}

/** String literals also match the constant name, so `== ERROR` works on ROS enum constants. */
export function conditionMatches(
  condition: MessagePathFilter,
  value: ValidQueriedDataValue,
  constantName: string | undefined,
): boolean {
  const subject =
    typeof condition.value === "string" && constantName != undefined ? constantName : value;
  return filterMatches(condition, subject);
}
