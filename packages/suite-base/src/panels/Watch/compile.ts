// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  MessagePath,
  MessagePathStructureItem,
  MessagePathStructureItemMessage,
  parseMessagePath,
  quoteFieldNameIfNeeded,
} from "@lichtblick/message-path";
import { traverseStructure } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import { resolveEnumNamesInPath } from "@lichtblick/suite-base/components/MessagePathSyntax/resolveEnumNames";
import { fillInGlobalVariablesInPath } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { pathToSubscribePayload } from "@lichtblick/suite-base/panels/Plot/utils/subscription";
import { SubscribePayload } from "@lichtblick/suite-base/players/types";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";

import { CompiledRow } from "./WatchStore";
import { WatchRow } from "./config";
import { EnumNames } from "./format";

type EnumValues = ReturnType<typeof enumValuesByDatatypeAndField>;

export type Schema = {
  structures: Record<string, MessagePathStructureItemMessage>;
  enumValues: EnumValues;
  schemaNames: ReadonlyMap<string, string>;
};

/** Constant names for the field a path ends on, e.g. `{0: "IDLE", 1: "MOVING"}`. */
export function enumNamesForPath(path: MessagePath, schema: Schema): EnumNames | undefined {
  const schemaName = schema.schemaNames.get(path.topicName);
  let item: MessagePathStructureItem | undefined =
    schemaName != undefined ? schema.structures[schemaName] : undefined;
  let container: string | undefined;
  let field: string | undefined;
  for (const part of path.messagePath) {
    switch (part.type) {
      case "name":
        container = item?.structureType === "message" ? item.datatype : undefined;
        field = part.name;
        item = item?.structureType === "message" ? item.nextByName[part.name] : undefined;
        break;
      case "slice":
        item = item?.structureType === "array" ? item.next : undefined;
        break;
      case "modifier":
        return undefined; // modified values are no longer the enum
      case "filter":
        break;
    }
  }
  if (path.modifier != undefined || container == undefined || field == undefined) {
    return undefined;
  }
  return schema.enumValues[container]?.[field];
}

/** The structure a path ends on, or undefined if the path or its topic is unknown. */
function structureAt(path: string, schema: Schema): MessagePathStructureItem | undefined {
  // A trailing stream modifier like `.@derivative` keeps the field's shape
  const parsed = parseMessagePath(path);
  if (!parsed) {
    return undefined;
  }
  const schemaName = schema.schemaNames.get(parsed.topicName);
  const root = schemaName != undefined ? schema.structures[schemaName] : undefined;
  const result = traverseStructure(root, parsed.messagePath);
  return result.valid ? result.structureItem : undefined;
}

/** Whether a path ends on a single field (not a message), so it is ready to watch. */
export function isLeafPath(path: string, schema: Schema): boolean {
  return structureAt(path, schema)?.structureType === "primitive";
}

/**
 * Every field below a path that ends on a message, in definition order, e.g. `.roll`, `.pitch`
 * and `.yaw` for `/imu.orientation.@rpy`. Arrays are skipped: their length varies, rows don't.
 * Empty for a single field or an unknown path.
 */
export function childPaths(path: string, schema: Schema): string[] {
  const paths: string[] = [];
  const visit = (item: MessagePathStructureItem, prefix: string) => {
    if (item.structureType === "primitive") {
      paths.push(prefix);
    } else if (item.structureType === "message") {
      for (const [name, next] of Object.entries(item.nextByName)) {
        visit(next, `${prefix}.${quoteFieldNameIfNeeded(name)}`);
      }
    }
  };
  const item = structureAt(path, schema);
  if (item?.structureType === "message") {
    visit(item, path);
  }
  return paths;
}

/**
 * What Enter in a path input adds: the path itself, or with Shift every field below it. `picked`
 * is set when the same Enter accepted an autocomplete suggestion; it then only adds a finished
 * field, so a completion that ends on a message keeps the input open for typing further.
 * Undefined means Enter does nothing here.
 */
export function pathsForEnter(
  path: string,
  { shiftKey, picked }: { shiftKey: boolean; picked: boolean },
  schema: Schema,
): string[] | undefined {
  const trimmed = path.trim();
  const parsed = parseMessagePath(trimmed);
  // A half-typed path like `/topic.field.` would only add a broken row. Topics that are not
  // known yet (e.g. not published so far) can't be checked, so any parsed path is fine there.
  if (
    !parsed ||
    (schema.schemaNames.has(parsed.topicName) && structureAt(trimmed, schema) == undefined)
  ) {
    return undefined;
  }
  if (shiftKey) {
    const children = childPaths(trimmed, schema);
    return children.length > 0 ? children : [trimmed];
  }
  return picked && !isLeafPath(trimmed, schema) ? undefined : [trimmed];
}

export type CompileResult = {
  compiled: CompiledRow[];
  /** Ids of rows whose path does not parse */
  invalid: ReadonlySet<string>;
  enumNames: ReadonlyMap<string, EnumNames>;
};

/** Stable key of a parsed path. Filter values like `{mode==1}` parse to bigints. */
function pathKey(path: MessagePath): string {
  return JSON.stringify(path, (_key, value: unknown) =>
    // An object so `1n` differs from the number 1 and the string "1n"
    typeof value === "bigint" ? { bigint: value.toString() } : value,
  )!;
}

export function compileRows(
  rows: readonly WatchRow[],
  globalVariables: GlobalVariables,
  schema: Schema,
): CompileResult {
  const compiled: CompiledRow[] = [];
  const invalid = new Set<string>();
  const enumNames = new Map<string, EnumNames>();
  for (const row of rows) {
    if (row.path.trim() === "") {
      continue;
    }
    const parsed = parseMessagePath(row.path);
    if (!parsed) {
      invalid.add(row.id);
      continue;
    }
    const filled = fillInGlobalVariablesInPath(parsed, globalVariables);
    const path = resolveEnumNamesInPath(
      filled,
      schema.structures,
      schema.enumValues,
      schema.schemaNames.get(filled.topicName),
    );
    compiled.push({ id: row.id, path, key: pathKey(path) });
    const names = enumNamesForPath(path, schema);
    if (names) {
      enumNames.set(row.id, names);
    }
  }
  return { compiled, invalid, enumNames };
}

/** One subscription per topic, with the union of the fields all rows on that topic read. */
export function subscriptionsFor(rows: readonly CompiledRow[]): SubscribePayload[] {
  // `undefined` fields: the whole message is needed
  const fieldsByTopic = new Map<string, Set<string> | undefined>();
  for (const row of rows) {
    const topic = row.path.topicName;
    const fields = pathToSubscribePayload(row.path, "partial")?.fields;
    if (fields == undefined) {
      fieldsByTopic.set(topic, undefined);
    } else if (!fieldsByTopic.has(topic)) {
      fieldsByTopic.set(topic, new Set(fields));
    } else {
      const existing = fieldsByTopic.get(topic);
      fields.forEach((field) => existing?.add(field));
    }
  }
  return [...fieldsByTopic].map(([topic, fields]) =>
    fields
      ? { topic, preloadType: "partial", fields: [...fields].sort() }
      : { topic, preloadType: "partial" },
  );
}
