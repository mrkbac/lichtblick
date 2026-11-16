// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinition, MessageDefinitionField } from "@foxglove/message-definition";

import { parseMessagePath } from "@lichtblick/message-path";
import { Immutable } from "@lichtblick/suite";

type GetSchema = (name: string) => Immutable<MessageDefinition> | undefined;

/** Whether `path` names a `float32[]` field, the only values the pie chart can show */
export function isFloat32ArrayPath(
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
  return field?.isArray === true && field.isComplex !== true && field.type === "float32";
}
