// SPDX-License-Identifier: MPL-2.0

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { describeChange } from "./describeChange";

function layout(panels: LayoutData["configById"], layoutNode?: LayoutData["layout"]): LayoutData {
  return {
    configById: panels,
    layout: layoutNode ?? { panels: Object.keys(panels) },
    globalVariables: {},
    userNodes: {},
    playbackConfig: { speed: 1 },
  };
}

describe("describeChange", () => {
  const title = (type: string) => type;
  const t = sharedI18nObject.getFixedT("en", "layoutHistory");

  it("summarizes added, removed and edited panels", () => {
    const prev = layout(
      { "Plot!a": { x: 1 }, "Image!b": {} },
      { direction: "row", children: [{ panels: ["Plot!a"] }, { panels: ["Image!b"] }] },
    );
    const next = layout(
      { "Plot!a": { x: 2 }, "Map!c": {} },
      { direction: "row", children: [{ panels: ["Plot!a"] }, { panels: ["Map!c"] }] },
    );
    expect(describeChange(prev, next, title, t)).toEqual([
      "Added Map",
      "Removed Image",
      "Changed Plot settings",
    ]);
  });

  it("describes the first version by its panel count", () => {
    expect(describeChange(undefined, layout({ "Plot!a": {} }), title, t)).toEqual(["1 panel"]);
  });
});
