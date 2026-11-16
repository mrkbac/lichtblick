// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinition, MessageDefinitionField } from "@foxglove/message-definition";

import { parseMessagePath } from "@lichtblick/message-path";
import { Immutable } from "@lichtblick/suite";

import { NUMERIC_TYPES } from "./constants";

type GetSchema = (name: string) => Immutable<MessageDefinition> | undefined;

/** Whether `path` names an array of numbers (e.g. `float32[]`, `uint32[]`), one slice per element */
export function isNumericArrayPath(
  path: string,
  getTopicSchema: GetSchema,
  getSchema: GetSchema,
): boolean {
  const parsed = parseMessagePath(path);
  if (!parsed) {
    return false;
  }
  let definition = getTopicSchema(parsed.topicName);
  let field: Immutable<MessageDefinitionField> | undefined;
  for (const part of parsed.messagePath) {
    // A slice or filter collects values from many messages, not one array field
    if (part.type !== "name" || definition == undefined) {
      return false;
    }
    field = definition.definitions.find((item) => item.name === part.name);
    definition = field?.isComplex === true ? getSchema(field.type) : undefined;
  }
  return field?.isArray === true && field.isComplex !== true && NUMERIC_TYPES.includes(field.type);
}
