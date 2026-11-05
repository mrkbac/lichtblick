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
});
