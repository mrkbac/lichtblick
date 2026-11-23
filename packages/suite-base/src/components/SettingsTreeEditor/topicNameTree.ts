// SPDX-License-Identifier: MPL-2.0

import { Immutable } from "@lichtblick/suite";

import { EditorSettingsTreeNode } from "./types";

type TopicEntry = readonly [string, Immutable<EditorSettingsTreeNode>];
export type TopicVisibility = readonly [topic: string, visible: boolean];

export type TopicNameTreeEntry =
  | {
      type: "topic";
      key: string;
      label: string;
      settings: Immutable<EditorSettingsTreeNode>;
    }
  | {
      type: "namespace";
      key: string;
      label: string;
      topics: TopicVisibility[];
      children: TopicNameTreeEntry[];
    };

type Namespace = {
  topic: TopicEntry | undefined;
  children: Map<string, Namespace>;
  topics: TopicVisibility[];
};

function makeNamespace(): Namespace {
  return { topic: undefined, children: new Map(), topics: [] };
}

/** Project the flat topic list for display. Filtered topics still contribute to branch visibility. */
export function buildTopicNameTree(
  allTopics: readonly TopicEntry[],
  matchingTopics: readonly TopicEntry[],
): TopicNameTreeEntry[] {
  const matches = new Map(matchingTopics);
  const root = makeNamespace();
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
        child = makeNamespace();
        current.children.set(segment, child);
      }
      current = child;
    }
    current.topic = entry;
  }

  function renderChildren(node: Namespace, parentPath: string): TopicNameTreeEntry[] {
    const result: TopicNameTreeEntry[] = [];
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
