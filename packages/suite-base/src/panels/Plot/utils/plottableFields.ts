// SPDX-License-Identifier: MPL-2.0

import {
  MessagePath,
  MessagePathStructureItem,
  MessagePathStructureItemMessage,
  parseMessagePath,
  quoteFieldNameIfNeeded,
} from "@lichtblick/message-path";
import { traverseStructure } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import {
  PLOTABLE_ROS_TYPES,
  ROS2_TIME_TYPES,
} from "@lichtblick/suite-base/panels/shared/constants";
import { Topic } from "@lichtblick/suite-base/players/types";

const isHeader = (datatype: string) => /(^|[/.])Header$/.test(datatype);

function collect(item: MessagePathStructureItem, prefix: string, out: string[]): void {
  if (item.structureType === "primitive") {
    if (item.primitiveType !== "string" && PLOTABLE_ROS_TYPES.includes(item.primitiveType)) {
      out.push(prefix);
    }
  } else if (item.structureType === "message" && ROS2_TIME_TYPES.includes(item.datatype)) {
    // A ROS 2 stamp plots as one value, like the `time` primitive, not as .sec and .nanosec
    out.push(prefix);
  } else if (item.structureType === "message" && (prefix === "" || !isHeader(item.datatype))) {
    for (const [name, next] of Object.entries(item.nextByName)) {
      collect(next, `${prefix}.${quoteFieldNameIfNeeded(name)}`, out);
    }
  }
  // Arrays are skipped: one series per element is rarely what someone adding a message wants.
}

function structureAt(
  parsed: MessagePath,
  structures: Readonly<Record<string, MessagePathStructureItemMessage>>,
  topics: readonly Topic[],
): MessagePathStructureItem | undefined {
  const schemaName = topics.find((topic) => topic.name === parsed.topicName)?.schemaName;
  const root = schemaName != undefined ? structures[schemaName] : undefined;
  const { valid, structureItem } = traverseStructure(root, parsed.messagePath);
  return valid ? structureItem : undefined;
}

function fieldsOf(path: string, item: MessagePathStructureItem): string[] {
  const fields: string[] = [];
  collect(item, "", fields);
  return fields.map((field) => path + field);
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
  const item = structureAt(parsed, structures, topics);
  return item?.structureType === "message" ? fieldsOf(path, item) : undefined;
}

/**
 * The series a typed path adds, or undefined when it isn't a valid series: a number (reference
 * line, e.g. `.5` or `1e+3`), a plottable field, or a message (one series per numeric field).
 * Paths with modifiers are taken as they are.
 */
export function resolvePlotPaths(
  path: string,
  structures: Readonly<Record<string, MessagePathStructureItemMessage>>,
  topics: readonly Topic[],
): string[] | undefined {
  if (path.trim() !== "" && Number.isFinite(Number(path))) {
    return [path];
  }
  const parsed = parseMessagePath(path);
  if (!parsed) {
    return undefined;
  }
  if (parsed.modifier != undefined || parsed.messagePath.some((part) => part.type === "modifier")) {
    return [path];
  }
  const item = structureAt(parsed, structures, topics);
  if (item?.structureType === "message") {
    const fields = fieldsOf(path, item);
    return fields.length > 0 ? fields : undefined;
  }
  return item?.structureType === "primitive" && PLOTABLE_ROS_TYPES.includes(item.primitiveType)
    ? [path]
    : undefined;
}
