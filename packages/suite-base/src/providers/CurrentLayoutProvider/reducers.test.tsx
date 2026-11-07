// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import { getPanelIds } from "@lichtblick/suite-base/util/layoutTree";

import panelsReducer, { defaultPlaybackConfig } from "./reducers";

const emptyLayout: LayoutData = {
  configById: {},
  globalVariables: {},
  userNodes: {},
  playbackConfig: defaultPlaybackConfig,
};

const twoPanels: LayoutNode = {
  direction: "row",
  children: [{ panels: ["First!a"] }, { panels: ["Second!b"] }],
  sizes: [50, 50],
};

const fourPanels: LayoutNode = {
  direction: "row",
  children: [
    { panels: ["FirstPanel!34otwwt"] },
    {
      direction: "column",
      children: [
        {
          direction: "row",
          children: [{ panels: ["FourthPanel!abc"] }, { panels: ["ThirdPanel!ye6m1m"] }],
          sizes: [50, 50],
        },
        { panels: ["SecondPanel!2wydzut"] },
      ],
      sizes: [50, 50],
    },
  ],
  sizes: [50, 50],
};

describe("layout reducers", () => {
  describe("adds panels", () => {
    it("adds a panel to an empty layout", () => {
      const panels = panelsReducer(emptyLayout, {
        type: "ADD_PANEL",
        payload: { id: "Audio!x", config: { foo: "bar" } },
      });
      expect(panels.layout).toEqual({ panels: ["Audio!x"] });
      expect(panels.configById).toEqual({ "Audio!x": { foo: "bar" } });
    });

    it("adds a panel on the left of the layout by default", () => {
      const panels = panelsReducer(
        { ...emptyLayout, layout: twoPanels },
        { type: "ADD_PANEL", payload: { id: "Audio!x" } },
      );
      expect(getPanelIds(panels.layout)).toEqual(["Audio!x", "First!a", "Second!b"]);
    });

    it("adds a panel next to a target or as a tab", () => {
      const below = panelsReducer(
        { ...emptyLayout, layout: twoPanels },
        {
          type: "ADD_PANEL",
          payload: { id: "Audio!x", position: "bottom", targetPanelId: "First!a" },
        },
      );
      expect(below.layout).toMatchObject({
        children: [
          { direction: "column", children: [{ panels: ["First!a"] }, { panels: ["Audio!x"] }] },
          {},
        ],
      });

      const tab = panelsReducer(
        { ...emptyLayout, layout: twoPanels },
        {
          type: "ADD_PANEL",
          payload: { id: "Audio!x", position: "center", targetPanelId: "Second!b" },
        },
      );
      expect(tab.layout).toMatchObject({
        children: [{}, { panels: ["Second!b", "Audio!x"], active: "Audio!x" }],
      });
    });
  });

  it("closes panels", () => {
    const single = panelsReducer(
      { ...emptyLayout, layout: { panels: ["First!a"] }, configById: { "First!a": {} } },
      { type: "CLOSE_PANEL", payload: { id: "First!a" } },
    );
    expect(single.layout).toBeUndefined();
    expect(single.configById).toEqual({});

    const multi = panelsReducer(
      { ...emptyLayout, layout: twoPanels },
      { type: "CLOSE_PANEL", payload: { id: "Second!b" } },
    );
    expect(multi.layout).toEqual({ panels: ["First!a"] });
  });

  it("groups panels as tabs", () => {
    const panels = panelsReducer(
      { ...emptyLayout, layout: fourPanels },
      {
        type: "GROUP_PANELS",
        payload: {
          targetPanelId: "ThirdPanel!ye6m1m",
          panelIds: ["FirstPanel!34otwwt", "SecondPanel!2wydzut"],
        },
      },
    );
    expect(panels.layout).toEqual({
      direction: "row",
      children: [
        { panels: ["FourthPanel!abc"] },
        { panels: ["ThirdPanel!ye6m1m", "FirstPanel!34otwwt", "SecondPanel!2wydzut"] },
      ],
      sizes: [50, 50],
    });
  });

  it("saves and overwrites user nodes", () => {
    let panels: LayoutData = { ...emptyLayout };
    const firstPayload = { foo: { name: "foo", sourceCode: "bar" } };
    const secondPayload = { bar: { name: "bar", sourceCode: "baz" } };

    panels = panelsReducer(panels, {
      type: "SET_USER_NODES",
      payload: firstPayload,
    });
    expect(panels.userNodes).toEqual(firstPayload);

    panels = panelsReducer(panels, {
      type: "SET_USER_NODES",
      payload: secondPayload,
    });
    expect(panels.userNodes).toEqual({ ...firstPayload, ...secondPayload });
  });

  describe("panel toolbar actions", () => {
    it("can split a panel, copying its config", () => {
      const panels = panelsReducer(
        { ...emptyLayout, layout: twoPanels, configById: { "First!a": { foo: "bar" } } },
        {
          type: "SPLIT_PANEL",
          payload: { id: "First!a", direction: "column", config: { foo: "bar" } },
        },
      );
      const [first, newId] = getPanelIds(panels.layout);
      expect(first).toEqual("First!a");
      expect(getPanelTypeFromId(newId!)).toEqual("First");
      expect(newId).not.toEqual("First!a");
      expect(panels.layout).toMatchObject({
        children: [
          { direction: "column", children: [{ panels: ["First!a"] }, { panels: [newId] }] },
          {},
        ],
      });
      expect(panels.configById[newId!]).toEqual({ foo: "bar" });
    });

    it("can swap panels", () => {
      const panels = panelsReducer(
        { ...emptyLayout, layout: twoPanels, configById: { "First!a": { foo: "bar" } } },
        {
          type: "SWAP_PANEL",
          payload: { originalId: "First!a", type: "Audio", config: { baz: 1 } },
        },
      );
      const [newId, second] = getPanelIds(panels.layout);
      expect(getPanelTypeFromId(newId!)).toEqual("Audio");
      expect(second).toEqual("Second!b");
      expect(panels.configById).toEqual({ [newId!]: { baz: 1 } });
    });
  });

  describe("clearing old saved config", () => {
    it("keeps panel state identity stable when config is unchanged", () => {
      const orig: LayoutData = { ...emptyLayout, layout: fourPanels };
      const configs = [
        { id: "SecondPanel!2wydzut", config: { foo: "bar" }, defaultConfig: { foo: "" } },
        { id: "FirstPanel!34otwwt", config: { baz: true }, defaultConfig: { baz: false } },
      ];
      const panels = panelsReducer(orig, { type: "SAVE_PANEL_CONFIGS", payload: { configs } });
      const panelsTwo = panelsReducer(panels, { type: "SAVE_PANEL_CONFIGS", payload: { configs } });
      expect(panelsTwo).toBe(panels);
    });

    it("removes a panel's configById when it is removed from the layout", () => {
      let panels: LayoutData = { ...emptyLayout, layout: fourPanels };
      panels = panelsReducer(panels, {
        type: "SAVE_PANEL_CONFIGS",
        payload: {
          configs: [
            { id: "SecondPanel!2wydzut", config: { foo: "bar" } },
            { id: "FirstPanel!34otwwt", config: { baz: true } },
          ],
        },
      });
      panels = panelsReducer(panels, {
        type: "CHANGE_PANEL_LAYOUT",
        payload: {
          layout: {
            direction: "row",
            children: [{ panels: ["FirstPanel!34otwwt"] }, { panels: ["SecondPanel!2wydzut"] }],
          },
        },
      });
      expect(panels.configById).toEqual({
        "SecondPanel!2wydzut": { foo: "bar" },
        "FirstPanel!34otwwt": { baz: true },
      });
      panels = panelsReducer(panels, {
        type: "CHANGE_PANEL_LAYOUT",
        payload: { layout: { panels: ["FirstPanel!34otwwt", "ThirdPanel!ye6m1m"] } },
      });
      expect(panels.configById).toEqual({ "FirstPanel!34otwwt": { baz: true } });
    });

    it("does not remove old configById when trimConfigById = false", () => {
      let panels: LayoutData = { ...emptyLayout, layout: { panels: ["foo!bar"] } };
      panels = panelsReducer(panels, {
        type: "SAVE_PANEL_CONFIGS",
        payload: { configs: [{ id: "foo!bar", config: { foo: "baz" } }] },
      });
      panels = panelsReducer(panels, {
        type: "CHANGE_PANEL_LAYOUT",
        payload: { layout: fourPanels, trimConfigById: false },
      });
      expect(panels.configById).toEqual({ "foo!bar": { foo: "baz" } });
    });
  });

  describe("Tab panels", () => {
    // Root: Tab!t beside A!1. Tab!t has two tabs; the first holds B!1 and C!1 side by side.
    const withTabs: LayoutData = {
      ...emptyLayout,
      layout: { direction: "row", children: [{ panels: ["Tab!t"] }, { panels: ["A!1"] }] },
      configById: {
        "Tab!t": {
          activeTabIdx: 0,
          tabs: [
            {
              title: "one",
              layout: { direction: "row", children: [{ panels: ["B!1"] }, { panels: ["C!1"] }] },
            },
            { title: "two" },
          ],
        },
        "A!1": { a: 1 },
        "B!1": { b: 1 },
        "C!1": { c: 1 },
      },
    };
    const tabLayout = (data: LayoutData, index: number) =>
      (data.configById["Tab!t"]!.tabs as { layout?: LayoutNode }[])[index]!.layout;

    it("keeps the configs of panels inside tabs when the root layout changes", () => {
      const result = panelsReducer(withTabs, {
        type: "CHANGE_PANEL_LAYOUT",
        payload: { layout: { panels: ["Tab!t", "A!1"] } },
      });
      expect(Object.keys(result.configById).sort()).toEqual(["A!1", "B!1", "C!1", "Tab!t"]);
    });

    it("moves a panel from the root into the shown tab and back", () => {
      const moved = panelsReducer(withTabs, {
        type: "ADD_PANEL",
        payload: { id: "A!1", position: "center", targetPanelId: "B!1" },
      });
      expect(moved.layout).toEqual({ panels: ["Tab!t"] });
      expect(getPanelIds(tabLayout(moved, 0))).toEqual(["B!1", "A!1", "C!1"]);
      expect(moved.configById["A!1"]).toEqual({ a: 1 });

      const back = panelsReducer(moved, {
        type: "ADD_PANEL",
        payload: { id: "A!1", position: "right", targetPanelId: "Tab!t" },
      });
      expect(getPanelIds(back.layout)).toEqual(["Tab!t", "A!1"]);
      expect(getPanelIds(tabLayout(back, 0))).toEqual(["B!1", "C!1"]);
    });

    it("adds a panel into an empty tab", () => {
      const shown = panelsReducer(withTabs, {
        type: "SAVE_PANEL_CONFIGS",
        payload: { configs: [{ id: "Tab!t", config: { activeTabIdx: 1 } }] },
      });
      const result = panelsReducer(shown, {
        type: "ADD_PANEL",
        payload: { id: "D!1", config: { d: 1 }, tabId: "Tab!t" },
      });
      expect(tabLayout(result, 1)).toEqual({ panels: ["D!1"] });
      expect(result.configById["D!1"]).toEqual({ d: 1 });
    });

    it("splits, swaps and closes panels inside a tab", () => {
      const split = panelsReducer(withTabs, {
        type: "SPLIT_PANEL",
        payload: { id: "B!1", direction: "column", config: {} },
      });
      expect(getPanelIds(tabLayout(split, 0))).toHaveLength(3);
      const swapped = panelsReducer(withTabs, {
        type: "SWAP_PANEL",
        payload: { originalId: "C!1", type: "D", config: {} },
      });
      expect(getPanelIds(tabLayout(swapped, 0))[1]).toMatch(/^D!/);
      expect(swapped.configById["C!1"]).toBeUndefined();
      const closed = panelsReducer(withTabs, { type: "CLOSE_PANEL", payload: { id: "C!1" } });
      expect(tabLayout(closed, 0)).toEqual({ panels: ["B!1"] });
      expect(closed.configById["C!1"]).toBeUndefined();
    });

    it("closing a Tab panel or one of its tabs drops the configs of the panels in it", () => {
      const closed = panelsReducer(withTabs, { type: "CLOSE_PANEL", payload: { id: "Tab!t" } });
      expect(Object.keys(closed.configById)).toEqual(["A!1"]);
      const tabClosed = panelsReducer(withTabs, {
        type: "SAVE_PANEL_CONFIGS",
        payload: { configs: [{ id: "Tab!t", config: { tabs: [{ title: "two" }] } }] },
      });
      expect(Object.keys(tabClosed.configById).sort()).toEqual(["A!1", "Tab!t"]);
    });

    it("changes the layout of a tab", () => {
      const result = panelsReducer(withTabs, {
        type: "CHANGE_PANEL_LAYOUT",
        payload: { layout: { panels: ["B!1"] }, tab: { panelId: "Tab!t", index: 0 } },
      });
      expect(tabLayout(result, 0)).toEqual({ panels: ["B!1"] });
      expect(result.configById["C!1"]).toBeUndefined();
      expect(result.layout).toBe(withTabs.layout);
    });

    it("won't put a Tab panel into one of its own tabs", () => {
      const result = panelsReducer(withTabs, {
        type: "ADD_PANEL",
        payload: { id: "Tab!t", position: "center", targetPanelId: "B!1" },
      });
      expect(result).toBe(withTabs);
    });
  });
});
