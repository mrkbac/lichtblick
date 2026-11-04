// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  MessagePath,
  MessagePathFilter,
  MessagePathStructureItem,
  MessagePathStructureItemMessage,
} from "@lichtblick/message-path";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";

type EnumValues = ReturnType<typeof enumValuesByDatatypeAndField>;

function resolveEnumFilter(
  filter: MessagePathFilter,
  structureItem: MessagePathStructureItem | undefined,
  enumValues: EnumValues,
): MessagePathFilter {
  let container = structureItem;
  for (const name of filter.path.slice(0, -1)) {
    container = container?.structureType === "message" ? container.nextByName[name] : undefined;
  }
  const field = filter.path.at(-1);
  const valuesByName =
    container != undefined && field != undefined
      ? enumValues[container.datatype]?.[field]
      : undefined;
  const entry = Object.entries(valuesByName ?? {}).find(([, name]) => name === filter.value);
  // An unknown name keeps `isEnum`, so the filter matches nothing
  return entry ? { ...filter, value: entry[0], isEnum: false } : filter;
}

/**
 * Replace bare enum names in filters, like `{status==MOVING}`, with the constant values from the
 * topic's schema.
 */
export function resolveEnumNamesInPath(
  path: MessagePath,
  structures: Record<string, MessagePathStructureItemMessage>,
  enumValues: EnumValues,
  schemaName: string | undefined,
): MessagePath {
  if (!path.messagePath.some((part) => part.type === "filter" && part.isEnum === true)) {
    return path;
  }
  let item: MessagePathStructureItem | undefined =
    schemaName != undefined ? structures[schemaName] : undefined;
  const messagePath = path.messagePath.map((part) => {
    switch (part.type) {
      case "name":
        item = item?.structureType === "message" ? item.nextByName[part.name] : undefined;
        break;
      case "slice":
        item = item?.structureType === "array" ? item.next : undefined;
        break;
      case "modifier":
        // The schema does not describe modifier results
        item = undefined;
        break;
      case "filter":
        return part.isEnum === true ? resolveEnumFilter(part, item, enumValues) : part;
    }
    return part;
  });
  return { ...path, messagePath };
}
