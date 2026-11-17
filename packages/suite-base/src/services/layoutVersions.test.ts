// SPDX-License-Identifier: MPL-2.0

import { describeChange } from "@lichtblick/suite-base/components/LayoutHistoryList/describeChange";
import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import {
  MAX_VERSIONS,
  VERSION_IDLE_MS,
  VERSION_MAX_SPAN_MS,
  addVersion,
} from "@lichtblick/suite-base/services/layoutVersions";

function layout(panels: LayoutData["configById"], layoutNode?: LayoutData["layout"]): LayoutData {
  return {
    configById: panels,
    layout: layoutNode ?? { panels: Object.keys(panels) },
    globalVariables: {},
    userNodes: {},
    playbackConfig: { speed: 1 },
  };
}

describe("addVersion", () => {
  const a = layout({ "Plot!a": { x: 1 } });
  const b = layout({ "Plot!a": { x: 2 } });
  const c = layout({ "Plot!a": { x: 3 } });

  it("skips data equal to the newest version", () => {
    expect(
      addVersion([{ savedAt: 0, data: a }], { savedAt: 1, data: layout({ "Plot!a": { x: 1 } }) }),
    ).toBe(undefined);
  });

  it("merges an editing burst into one version but never overwrites the opened checkpoint", () => {
    let versions = addVersion([], { savedAt: 0, data: a, kind: "opened" })!;
    versions = addVersion(versions, { savedAt: 10, data: b })!;
    expect(versions.map((v) => v.data)).toEqual([a, b]);
    versions = addVersion(versions, { savedAt: 20, data: c })!;
    expect(versions.map((v) => v.data)).toEqual([a, c]);
    versions = addVersion(versions, { savedAt: 20 + VERSION_IDLE_MS, data: b })!;
    expect(versions.map((v) => v.data)).toEqual([a, c, b]);
  });

  it("splits continuous editing into versions of bounded span", () => {
    let versions = addVersion([], { savedAt: 0, data: layout({ "Plot!a": { x: 0 } }) })!;
    // A save every 10s for 25 minutes: never idle, yet not one giant version.
    for (let t = 10_000; t <= 25 * 60_000; t += 10_000) {
      versions = addVersion(versions, { savedAt: t, data: layout({ "Plot!a": { x: t } }) })!;
    }
    expect(versions).toHaveLength(Math.ceil((25 * 60_000) / VERSION_MAX_SPAN_MS));
  });

  it("keeps a restore as its own entry next to the state it replaced", () => {
    let versions = addVersion([], { savedAt: 0, data: a })!;
    versions = addVersion(versions, { savedAt: 1, data: b, kind: "restored" })!;
    versions = addVersion(versions, { savedAt: 2, data: c })!;
    expect(versions.map((v) => v.data)).toEqual([a, b, c]);
  });

  it("drops the oldest versions past the limit", () => {
    const many = Array.from({ length: MAX_VERSIONS }, (_, i) => ({
      savedAt: i * VERSION_IDLE_MS,
      VERSION_MAX_SPAN_MS,
      data: layout({ [`Plot!${i}`]: {} }),
    }));
    const next = addVersion(many, { savedAt: MAX_VERSIONS * VERSION_IDLE_MS, data: a })!;
    expect(next).toHaveLength(MAX_VERSIONS);
    expect(next.at(-1)!.data).toBe(a);
    expect(next[0]!.data).toBe(many[1]!.data);
  });
});

describe("describeChange", () => {
  const title = (type: string) => type;

  it("summarizes added, removed and edited panels", () => {
    const prev = layout(
      { "Plot!a": { x: 1 }, "Image!b": {} },
      { direction: "row", children: [{ panels: ["Plot!a"] }, { panels: ["Image!b"] }] },
    );
    const next = layout(
      { "Plot!a": { x: 2 }, "Map!c": {} },
      { direction: "row", children: [{ panels: ["Plot!a"] }, { panels: ["Map!c"] }] },
    );
    expect(describeChange(prev, next, title)).toEqual([
      "Added Map",
      "Removed Image",
      "Changed Plot settings",
    ]);
  });

  it("describes the first version by its panel count", () => {
    expect(describeChange(undefined, layout({ "Plot!a": {} }), title)).toEqual(["1 panel"]);
  });
});
