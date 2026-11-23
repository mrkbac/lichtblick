// SPDX-License-Identifier: MPL-2.0

import { Immutable } from "@lichtblick/suite";

import { EditorSettingsTreeNode } from "./types";

type NamedItem = { readonly label?: string; readonly visible?: boolean };
type TopicEntry<T extends NamedItem> = readonly [string, T];
export type TopicVisibility = readonly [topic: string, visible: boolean];

export type TopicNameTreeEntry<T extends NamedItem = Immutable<EditorSettingsTreeNode>> =
  | {
      type: "topic";
      key: string;
      label: string;
      settings: T;
    }
  | {
      type: "namespace";
      key: string;
      label: string;
      topics: TopicVisibility[];
      children: TopicNameTreeEntry<T>[];
    };

type Namespace<T extends NamedItem> = {
  topic: TopicEntry<T> | undefined;
  children: Map<string, Namespace<T>>;
  topics: TopicVisibility[];
};

function makeNamespace<T extends NamedItem>(): Namespace<T> {
  return { topic: undefined, children: new Map(), topics: [] };
}

/** Project the flat topic list for display. Filtered topics still contribute to branch visibility. */
export function buildTopicNameTree<T extends NamedItem>(
  allTopics: readonly TopicEntry<T>[],
  matchingTopics: readonly TopicEntry<T>[],
): TopicNameTreeEntry<T>[] {
  const matches = new Map(matchingTopics);
  const root = makeNamespace<T>();
  for (const entry of allTopics) {
    const [key, settings] = entry;
    const segments = key.replace(/^\//, "").split("/");
    if (key.startsWith("/")) {
      segments[0] = "/" + segments[0]!;
    }
    let current = root;
    for (const segment of segments) {
      if (settings.visible != undefined) {
        current.topics.push([key, settings.visible]);
      }
      let child = current.children.get(segment);
      if (!child) {
        child = makeNamespace<T>();
        current.children.set(segment, child);
      }
      current = child;
    }
    current.topic = entry;
  }

  function renderChildren(node: Namespace<T>, parentPath: string): TopicNameTreeEntry<T>[] {
    const result: TopicNameTreeEntry<T>[] = [];
    for (const [segment, child] of node.children) {
      let branch = child;
      let label = segment;
      while (!branch.topic && branch.children.size === 1) {
        const [nextSegment, nextBranch] = branch.children.entries().next().value!;
        label += "/" + nextSegment;
        branch = nextBranch;
      }
      const key = parentPath + label;
      const topic = branch.topic?.[0];
      const settings = topic == undefined ? undefined : matches.get(topic);
      if (topic != undefined && settings) {
        result.push({
          type: "topic",
          key: topic,
          label: settings.label == undefined || settings.label === topic ? label : settings.label,
          settings,
        });
      }
      const children = renderChildren(branch, key + "/");
      if (children.length > 0) {
        result.push({ type: "namespace", key, label, topics: branch.topics, children });
      }
    }
    return result;
  }

  return renderChildren(root, "");
}
