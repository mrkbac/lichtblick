// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";
import YAML, { SchemaOptions } from "yaml";

import { ParameterValue } from "@lichtblick/suite";

export type ParameterType =
  | "bool"
  | "int"
  | "float"
  | "string"
  | "bytes"
  | "time"
  | "list"
  | "dict"
  | "unset";

export function parameterType(value: ParameterValue): ParameterType {
  if (value == undefined) {
    return "unset";
  } else if (typeof value === "boolean") {
    return "bool";
  } else if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  } else if (typeof value === "string") {
    return "string";
  } else if (value instanceof Uint8Array) {
    return "bytes";
  } else if (value instanceof Date) {
    return "time";
  } else if (Array.isArray(value)) {
    return "list";
  }
  return "dict";
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

/** Parses "00 ff 1a" or "00ff1a"; returns undefined for invalid input. */
export function hexToBytes(text: string): Uint8Array | undefined {
  const hex = text.replace(/\s+/g, "");
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return undefined;
  }
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

/** Single-line text representation used for display, copy and editing. */
export function formatValue(value: ParameterValue): string {
  if (value == undefined) {
    return "";
  } else if (value instanceof Date) {
    return value.toISOString();
  } else if (value instanceof Uint8Array) {
    return bytesToHex(value);
  } else if (typeof value === "string") {
    return value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

// Natural sort so `joint_2` comes before `joint_10`
const collator = new Intl.Collator(undefined, { numeric: true });
export function compareNames(a: string, b: string): number {
  const result = collator.compare(a, b);
  return result !== 0 ? result : a < b ? -1 : a > b ? 1 : 0;
}

export type Row =
  | { kind: "group"; key: string; label: string; depth: number; count: number }
  | { kind: "param"; key: string; label: string; depth: number };

type TrieNode = {
  children: Map<string, TrieNode>;
  param?: string;
  count: number;
};

const SEPARATOR = /[/.]/;

/**
 * Builds the visible rows of the namespace tree. Names are split at `/` and `.`; chains of
 * namespaces that contain only one sub-namespace are merged into one row (`robot/arm`).
 * Groups are keyed by the exact name prefix (e.g. `/robot/arm`), so keys are stable.
 */
export function buildRows(
  names: readonly string[],
  { tree, collapsed }: { tree: boolean; collapsed: ReadonlySet<string> },
): Row[] {
  const sorted = [...names].sort(compareNames);
  if (!tree) {
    return sorted.map((name) => ({
      kind: "param",
      key: name,
      label: name,
      depth: 0,
    }));
  }

  const root: TrieNode = { children: new Map(), count: 0 };
  for (const name of sorted) {
    let node = root;
    node.count++;
    for (let i = 1; i < name.length; i++) {
      if (SEPARATOR.test(name[i]!) && i < name.length - 1) {
        const prefix = name.slice(0, i);
        let child = node.children.get(prefix);
        if (!child) {
          child = { children: new Map(), count: 0 };
          node.children.set(prefix, child);
        }
        child.count++;
        node = child;
      }
    }
    // Leaf nodes are keyed by the full name, which can't collide with a prefix of another name
    const leaf: TrieNode = node.children.get(name) ?? {
      children: new Map(),
      count: 0,
    };
    leaf.param = name;
    node.children.set(name, leaf);
  }

  const rows: Row[] = [];
  const visit = (node: TrieNode, parentKey: string, depth: number) => {
    // Namespaces first, then parameters; both sorted by their displayed label
    const entries = [...node.children].sort(([keyA, a], [keyB, b]) => {
      const kind = Number(a.children.size === 0) - Number(b.children.size === 0);
      return kind !== 0 ? kind : compareNames(labelOf(keyA, parentKey), labelOf(keyB, parentKey));
    });
    for (const [key, child] of entries) {
      if (child.children.size === 0) {
        rows.push({
          kind: "param",
          key,
          label: labelOf(key, parentKey),
          depth,
        });
        continue;
      }
      if (child.param != undefined) {
        // A name that is both a parameter and a namespace (`a` and `a.b`)
        rows.push({
          kind: "param",
          key,
          label: labelOf(key, parentKey),
          depth,
        });
      }
      let groupKey = key;
      let group = child;
      while (group.param == undefined && group.children.size === 1) {
        const [onlyKey, only] = group.children.entries().next().value!;
        if (only.children.size === 0) {
          break;
        }
        groupKey = onlyKey;
        group = only;
      }
      rows.push({
        kind: "group",
        key: groupKey,
        label: labelOf(groupKey, parentKey),
        depth,
        count: group.count,
      });
      if (!collapsed.has(groupKey)) {
        visit(group, groupKey, depth + 1);
      }
    }
  };
  visit(root, "", 0);
  return rows;
}

function labelOf(key: string, parentKey: string): string {
  const label = key.slice(parentKey.length);
  return SEPARATOR.test(label[0] ?? "") && label.length > 1 ? label.slice(1) : label;
}

/** All namespace keys in the tree, used for "collapse all". */
export function allGroupKeys(names: readonly string[]): string[] {
  return buildRows(names, { tree: true, collapsed: new Set() })
    .filter((row) => row.kind === "group")
    .map((row) => row.key);
}

/** Returns a name matcher, or an Error for an invalid regex. Case-insensitive. */
export function makeMatcher(
  query: string,
  { regex }: { regex: boolean },
): ((name: string) => boolean) | Error {
  if (query === "") {
    return () => true;
  }
  if (regex) {
    try {
      const re = new RegExp(query, "i");
      return (name) => re.test(name);
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }
  const needle = query.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

export type DiffStatus = "added" | "removed" | "changed";

/** Differences of `current` relative to `snapshot`; unchanged names are omitted. */
export function diffParameters(
  current: ReadonlyMap<string, ParameterValue>,
  snapshot: ReadonlyMap<string, ParameterValue>,
): Map<string, DiffStatus> {
  const diff = new Map<string, DiffStatus>();
  for (const [name, value] of current) {
    if (!snapshot.has(name)) {
      diff.set(name, "added");
    } else if (!_.isEqual(normalize(value), normalize(snapshot.get(name)))) {
      diff.set(name, "changed");
    }
  }
  for (const name of snapshot.keys()) {
    if (!current.has(name)) {
      diff.set(name, "removed");
    }
  }
  return diff;
}

// YAML has no `undefined` and parses `!!binary` as a Buffer in Node; normalize both for comparison
function normalize(value: ParameterValue): unknown {
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  return value ?? null;
}

const YAML_OPTIONS: SchemaOptions = { customTags: ["binary", "timestamp"] };

/** Flat `name: value` YAML; bytes use `!!binary`, dates `!!timestamp`. */
export function parametersToYaml(parameters: ReadonlyMap<string, ParameterValue>): string {
  const entries = [...parameters.keys()]
    .sort(compareNames)
    .map((name) => [name, parameters.get(name) ?? null]);
  return YAML.stringify(Object.fromEntries(entries), YAML_OPTIONS);
}

export function parametersFromYaml(text: string): Map<string, ParameterValue> {
  const parsed: unknown = YAML.parse(text, YAML_OPTIONS);
  if (parsed == undefined) {
    return new Map();
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a YAML map of parameter names to values");
  }
  return new Map(
    Object.entries(parsed as Record<string, ParameterValue | null>).map(([name, value]) => [
      name,
      value instanceof Uint8Array ? new Uint8Array(value) : (value ?? undefined),
    ]),
  );
}
