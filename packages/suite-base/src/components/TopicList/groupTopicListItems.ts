// SPDX-License-Identifier: MPL-2.0

import {
  buildTopicNameTree,
  TopicNameTreeEntry,
} from "@lichtblick/suite-base/components/SettingsTreeEditor/topicNameTree";

import { TopicListItem } from "./useTopicListSearch";

// `label` gives the tree builder a field it knows; topic rows never set one.
type TopicItem = Extract<TopicListItem, { type: "topic" }> & { label?: string };

export type NamespaceRow = {
  type: "namespace";
  key: string;
  label: string;
  depth: number;
  expanded: boolean;
  topicCount: number;
};

/** A list row; `depth` and `label` are set in tree mode. */
export type TopicListRow = (TopicListItem & { depth?: number; label?: string }) | NamespaceRow;

function countTopics(entries: readonly TopicNameTreeEntry<TopicItem>[]): number {
  let count = 0;
  for (const entry of entries) {
    count += entry.type === "topic" ? 1 : countTopics(entry.children);
  }
  return count;
}

/** Groups the flat search results by topic name segments, the same way the settings sidebar does. */
export function groupTopicListItems(
  items: readonly TopicListItem[],
  isExpanded: (namespaceKey: string) => boolean,
): TopicListRow[] {
  const topics: [string, TopicItem][] = [];
  const pathsByTopic = new Map<string, TopicListItem[]>();
  for (const item of items) {
    if (item.type === "topic") {
      topics.push([item.item.item.name, { ...item, label: undefined }]);
    } else {
      const name = item.item.item.topic.name;
      pathsByTopic.set(name, [...(pathsByTopic.get(name) ?? []), item]);
    }
  }
  topics.sort(([a], [b]) => a.localeCompare(b));

  const rows: TopicListRow[] = [];
  const visit = (entries: readonly TopicNameTreeEntry<TopicItem>[], depth: number) => {
    for (const entry of entries) {
      if (entry.type === "topic") {
        rows.push({ ...entry.settings, depth, label: entry.label });
        for (const path of pathsByTopic.get(entry.key) ?? []) {
          rows.push({ ...path, depth });
        }
        continue;
      }
      const expanded = isExpanded(entry.key);
      const { key, label, children } = entry;
      rows.push({
        type: "namespace",
        key,
        label,
        depth,
        expanded,
        topicCount: countTopics(children),
      });
      if (expanded) {
        visit(children, depth + 1);
      }
    }
  };
  visit(buildTopicNameTree(topics, topics), 0);
  return rows;
}
