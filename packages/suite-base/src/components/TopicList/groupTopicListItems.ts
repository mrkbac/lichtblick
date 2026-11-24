// SPDX-License-Identifier: MPL-2.0

import {
  buildTopicNameTree,
  TopicNameTreeEntry,
} from "@lichtblick/suite-base/components/SettingsTreeEditor/topicNameTree";

import { TopicListItem } from "./useTopicListSearch";

// `visible` makes the tree builder list every topic under each namespace, which gives the count.
type TopicItem = Extract<TopicListItem, { type: "topic" }> & { visible: true };

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

/** Groups the flat search results by topic name segments, the same way the settings sidebar does. */
export function groupTopicListItems(
  items: readonly TopicListItem[],
  isExpanded: (namespaceKey: string) => boolean,
): TopicListRow[] {
  const topics: [string, TopicItem][] = [];
  const pathsByTopic = new Map<string, TopicListItem[]>();
  for (const item of items) {
    if (item.type === "topic") {
      topics.push([item.item.item.name, { ...item, visible: true }]);
    } else {
      const name = item.item.item.topic.name;
      let paths = pathsByTopic.get(name);
      if (!paths) {
        paths = [];
        pathsByTopic.set(name, paths);
      }
      paths.push(item);
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
      const { key, label, children, topics: namespaceTopics } = entry;
      rows.push({
        type: "namespace",
        key,
        label,
        depth,
        expanded,
        topicCount: namespaceTopics.length,
      });
      if (expanded) {
        visit(children, depth + 1);
      }
    }
  };
  visit(buildTopicNameTree(topics, topics), 0);
  return rows;
}
