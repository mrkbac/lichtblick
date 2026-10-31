// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Topic } from "@lichtblick/suite-base/players/types";

import { aggregateBuckets, TopicInspection } from "./inspection";

type Node = {
  path: string;
  children: Map<string, Node>;
  topic?: Topic;
  count: number;
  topics: Topic[];
};
export type TopicTreeRow =
  | { kind: "namespace"; path: string; depth: number; count: number; topics: Topic[] }
  | { kind: "topic"; topic: Topic; depth: number };

/** Keeps the requested topic sort order within each namespace. */
export function topicTreeRows(
  topics: readonly Topic[],
  collapsed: ReadonlySet<string>,
  compareGroups?: (
    left: readonly Topic[],
    right: readonly Topic[],
    leftKind: "namespace" | "topic",
    rightKind: "namespace" | "topic",
  ) => number,
): TopicTreeRow[] {
  const root: Node = { path: "", children: new Map(), count: 0, topics: [] };
  for (const topic of topics) {
    const parts = (topic.name.startsWith("/") ? topic.name.slice(1) : topic.name).split("/");
    let node = root;
    for (const [index, part] of parts.entries()) {
      const path = `${topic.name.startsWith("/") ? "/" : ""}${parts.slice(0, index + 1).join("/")}`;
      let child = node.children.get(part);
      if (!child) {
        child = { path, children: new Map(), count: 0, topics: [] };
        node.children.set(part, child);
      }
      child.count++;
      child.topics.push(topic);
      node = child;
    }
    node.topic = topic;
  }
  const rows: TopicTreeRow[] = [];
  function visit(node: Node, depth: number) {
    let childDepth = depth;
    if (node.children.size > 0 && node !== root) {
      rows.push({
        kind: "namespace",
        path: node.path,
        depth,
        count: node.count,
        topics: node.topics,
      });
      if (collapsed.has(node.path)) {
        return;
      }
      childDepth++;
    }
    if (node.topic) {
      rows.push({ kind: "topic", topic: node.topic, depth: childDepth });
    }
    const children = [...node.children.values()];
    if (compareGroups) {
      children.sort((left, right) =>
        compareGroups(
          left.topics,
          right.topics,
          left.children.size > 0 ? "namespace" : "topic",
          right.children.size > 0 ? "namespace" : "topic",
        ),
      );
    }
    for (const child of children) {
      visit(child, childDepth);
    }
  }
  visit(root, 0);
  return rows;
}

/** Unscanned descendants never silently become zero-sized complete totals. */
export function namespaceTotals(
  topics: readonly Topic[],
  inspections: ReadonlyMap<string, TopicInspection>,
  countFor: (topic: Topic) => number | undefined,
): {
  count?: number;
  bytes: number;
  estimatedBytes: boolean;
  scanned: number;
  complete: boolean;
  buckets: number[];
} {
  const counts = topics.map(countFor);
  const measured = topics.flatMap((topic) => {
    const data = inspections.get(topic.name);
    return data ? [data] : [];
  });
  return {
    count: counts.every((count) => count != undefined)
      ? counts.reduce<number>((sum, count) => sum + count, 0)
      : undefined,
    bytes: measured.reduce((sum, data) => sum + data.bytes, 0),
    estimatedBytes: measured.some((data) => data.estimatedBytes),
    scanned: measured.length,
    complete: measured.length === topics.length,
    buckets: aggregateBuckets(measured),
  };
}
