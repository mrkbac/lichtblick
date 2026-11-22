// SPDX-License-Identifier: MPL-2.0

import {
  MessagePathStructureItem,
  MessagePathStructureItemMessage,
  parseMessagePath,
  quoteFieldNameIfNeeded,
} from "@lichtblick/message-path";
import { traverseStructure } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import { PLOTABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/shared/constants";
import { Topic } from "@lichtblick/suite-base/players/types";

const isHeader = (datatype: string) => /(^|[/.])Header$/.test(datatype);

function collect(item: MessagePathStructureItem, prefix: string, out: string[]): void {
  if (item.structureType === "primitive") {
    if (item.primitiveType !== "string" && PLOTABLE_ROS_TYPES.includes(item.primitiveType)) {
      out.push(prefix);
    }
  } else if (item.structureType === "message" && (prefix === "" || !isHeader(item.datatype))) {
    for (const [name, next] of Object.entries(item.nextByName)) {
      collect(next, `${prefix}.${quoteFieldNameIfNeeded(name)}`, out);
    }
  }
  // Arrays are skipped: one series per element is rarely what someone adding a message wants.
}

/**
 * The numeric fields of the message a path points to, as paths, e.g. `/imu.linear_acceleration`
 * → `/imu.linear_acceleration.x`, `.y`, `.z`. Skips headers and arrays. Undefined when the path
 * doesn't point to a message (a field, an invalid path, a path with a time-series modifier).
 */
export function plottableFields(
  path: string,
  structures: Readonly<Record<string, MessagePathStructureItemMessage>>,
  topics: readonly Topic[],
): string[] | undefined {
  const parsed = parseMessagePath(path);
  if (!parsed || parsed.modifier != undefined) {
    return undefined;
  }
  const schemaName = topics.find((topic) => topic.name === parsed.topicName)?.schemaName;
  const root = schemaName != undefined ? structures[schemaName] : undefined;
  const { valid, structureItem } = traverseStructure(root, parsed.messagePath);
  if (!valid || structureItem?.structureType !== "message") {
    return undefined;
  }
  const fields: string[] = [];
  collect(structureItem, "", fields);
  return fields.map((field) => path + field);
}
