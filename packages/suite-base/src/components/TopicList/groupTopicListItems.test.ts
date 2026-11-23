// SPDX-License-Identifier: MPL-2.0

import { groupTopicListItems, TopicListRow } from "./groupTopicListItems";
import { TopicListItem } from "./useTopicListSearch";

function topic(name: string): TopicListItem {
  return {
    type: "topic",
    item: { item: { name, schemaName: "S" }, positions: new Set(), start: 0, end: 0, score: 0 },
  };
}

function describeRows(rows: TopicListRow[]): string[] {
  return rows.map((row) =>
    row.type === "namespace"
      ? `${row.depth}:[${row.label}] ${row.topicCount}${row.expanded ? "" : " +"}`
      : `${row.depth}:${row.label}`,
  );
}

describe("groupTopicListItems", () => {
  const items = ["/b/x", "/a/one/p", "/a/two", "/c"].map(topic);

  it("groups by name segments, sorted, collapsing single-child chains", () => {
    expect(describeRows(groupTopicListItems(items, () => true))).toEqual([
      "0:[/a] 2",
      "1:one/p",
      "1:two",
      "0:/b/x",
      "0:/c",
    ]);
  });

  it("hides the children of collapsed namespaces", () => {
    expect(describeRows(groupTopicListItems(items, (key) => key === "/a/one"))).toEqual([
      "0:[/a] 2 +",
      "0:/b/x",
      "0:/c",
    ]);
  });
});
