/** @jest-environment jsdom */

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

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { useDebounce } from "use-debounce";
import type { Mock } from "vitest";

import { MessagePath, parseMessagePath } from "@lichtblick/message-path";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import MockPanelContextProvider from "@lichtblick/suite-base/components/MockPanelContextProvider";
import { useUserProfileStorage } from "@lichtblick/suite-base/context/UserProfileStorageContext";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";
import MockLayoutManager from "@lichtblick/suite-base/services/LayoutManager/MockLayoutManager";
import { BasicBuilder } from "@lichtblick/test-builders";

import MessagePathInput, {
  tryToSetDefaultGlobalVar,
  getFirstInvalidVariableFromRosPath,
  getModifierNameAutocomplete,
  getModifierResultFieldAutocomplete,
} from "./MessagePathInput";
import { messagePathStructures, traverseStructure } from "./messagePathsForDatatype";
import { MessagePathInputBaseProps } from "./types";

// Re-assignable mocks for tests
let mockDatatypes = new Map();
let mockTopics: Array<{ name: string; schemaName?: string }> = [];

vi.mock("@lichtblick/suite-base/hooks/useGlobalVariables");
vi.mock("@lichtblick/suite-base/components/MessagePipeline");
vi.mock("@lichtblick/suite-base/context/UserProfileStorageContext");
vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext");
vi.mock("@lichtblick/suite-base/PanelAPI", () => ({
  useDataSourceInfo: () => ({
    datatypes: mockDatatypes,
    topics: mockTopics,
  }),
}));
vi.mock("@lichtblick/suite-base/services/LayoutManager/LayoutManager", () => ({
  default: vi.fn(() => {
    return new MockLayoutManager();
  }),
}));
vi.mock("use-debounce");
// jsdom has no layout, so render every autocomplete row
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: 0, size: 0 })),
    getTotalSize: () => 0,
  }),
}));

describe("tryToSetDefaultGlobalVar", () => {
  it("correctly returns true/false depending on whether a global variable has a default", () => {
    const setGlobalVars = vi.fn();
    expect(tryToSetDefaultGlobalVar("some_var_without_default", setGlobalVars)).toEqual(false);
    expect(setGlobalVars).not.toHaveBeenCalled();
  });
});

describe("getFirstInvalidVariableFromRosPath", () => {
  it("returns all possible message paths when not passing in `validTypes`", () => {
    const setGlobalVars = vi.fn();
    const defaultOperator = "==";
    const rosPath: MessagePath = {
      topicName: "/some_topic",
      topicNameRepr: "/some_topic",
      messagePath: [
        { type: "name", name: "fieldName", repr: "fieldName" },
        { type: "slice", start: 0, end: Infinity },
        {
          type: "filter",
          path: ["myId"],
          value: { variableName: "not_yet_set_global_var", startLoc: 10 },
          nameLoc: 11,
          valueLoc: 10,
          repr: "myId==$not_yet_set_global_var",
          operator: defaultOperator,
        },
      ],
      modifier: undefined,
    };
    expect(getFirstInvalidVariableFromRosPath(rosPath, {}, setGlobalVars)).toEqual({
      loc: 10,
      variableName: "not_yet_set_global_var",
    });
    expect(setGlobalVars).not.toHaveBeenCalled();

    expect(
      getFirstInvalidVariableFromRosPath(rosPath, { not_yet_set_global_var: 5 }, setGlobalVars),
    ).toEqual(undefined);
    expect(setGlobalVars).not.toHaveBeenCalled();
  });
});

describe("modifier autocomplete", () => {
  const structure = messagePathStructures(
    new Map([
      [
        "msg",
        {
          definitions: [
            { name: "speed", type: "float64" },
            { name: "orientation", type: "quaternion" },
          ],
        },
      ],
      [
        "quaternion",
        {
          definitions: ["x", "y", "z", "w"].map((name) => ({ name, type: "float64" })),
        },
      ],
    ]),
  ).msg;

  const nameAutocomplete = (path: string, { supportsStreamModifiers = false } = {}) => {
    const rosPath = parseMessagePath(path)!;
    return getModifierNameAutocomplete(
      path,
      rosPath,
      traverseStructure(structure, rosPath.messagePath),
      { supportsStreamModifiers },
    );
  };

  it("suggests modifier names that apply to the value", () => {
    expect(nameAutocomplete("/t.orientation.@r")).toEqual({
      autocompleteItems: ["norm", "rpy", "ypr", "yrp"],
      autocompleteFilterText: "r",
      autocompleteRange: { start: 16, end: 17 },
    });
    expect(nameAutocomplete("/t.speed.@")?.autocompleteItems).toContain("mul(1)");
    expect(nameAutocomplete("/t.speed.@")?.autocompleteItems).not.toContain("delta");
    expect(
      nameAutocomplete("/t.speed.@", { supportsStreamModifiers: true })?.autocompleteItems,
    ).toContain("delta");
    // Complete modifiers need no suggestions
    expect(nameAutocomplete("/t.speed.@abs")).toBeUndefined();
    // Only scalar modifiers follow a time-series modifier
    const afterDelta = nameAutocomplete("/t.speed.@delta.@ab", { supportsStreamModifiers: true });
    expect(afterDelta?.autocompleteItems).toContain("abs");
    expect(afterDelta?.autocompleteItems).not.toContain("length");
    expect(afterDelta?.autocompleteItems).not.toContain("delta");
    expect(afterDelta?.autocompleteFilterText).toBe("ab");
    expect(nameAutocomplete("/t.speed.@delta.@abs")).toBeUndefined();
  });

  it("suggests fields of a modifier result", () => {
    const path = "/t.orientation.@rpy.y";
    expect(
      getModifierResultFieldAutocomplete(path, parseMessagePath(path)!, structure, {}),
    ).toEqual({
      autocompleteItems: expect.arrayContaining([
        ".orientation.@rpy.roll",
        ".orientation.@rpy.pitch",
        ".orientation.@rpy.yaw",
      ]),
      autocompleteFilterText: ".orientation.@rpy.y",
      autocompleteRange: { start: 2, end: Infinity },
    });
    const numeric = "/t.speed.@abs.";
    expect(
      getModifierResultFieldAutocomplete(numeric, parseMessagePath(numeric)!, structure, {}),
    ).toBeUndefined();
  });
});

describe("MessagePathInput Component", () => {
  const mockOnChange = vi.fn();
  (useGlobalVariables as Mock).mockReturnValue({
    globalVariables: {},
    setGlobalVariables: vi.fn(),
  });
  (useMessagePipeline as Mock).mockReturnValue({});
  (useUserProfileStorage as Mock).mockReturnValue({
    getUserProfile: {},
    setUserProfile: vi.fn(),
  });
  (useDebounce as Mock).mockImplementation((value) => {
    return [value];
  });

  const renderComponent = (propsOverride: Partial<MessagePathInputBaseProps> = {}) => {
    const props: MessagePathInputBaseProps = {
      onChange: mockOnChange,
      path: "",
      index: 0,
      ...propsOverride,
    };

    const ui: React.ReactElement = (
      <MockPanelContextProvider>
        <MessagePathInput {...props} />
      </MockPanelContextProvider>
    );

    return {
      ...render(ui),
      user: userEvent.setup(),
    };
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should update value when onChange is called", async () => {
    renderComponent();

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "newValue" } });

    expect(input.getAttribute("value")).toBe("newValue");
  });

  it('should insert "}" after typing "{"', async () => {
    const { user } = renderComponent();

    const input = screen.getByRole("combobox");
    await user.type(input, "{{");

    expect(mockOnChange).toHaveBeenCalledWith("{}", 0);
  });

  it.each<[string, Partial<MessagePathInputBaseProps>, boolean]>([
    ["/t.x.@abs", {}, true],
    ["/t.x.@abs", { supportsMathModifiers: true }, false],
    ["/t.x.@delta", { supportsMathModifiers: true }, true],
    ["/t.x.@delta", { supportsMathModifiers: true, supportsStreamModifiers: true }, false],
    ["/t.x.@@delta", { supportsMathModifiers: true, supportsStreamModifiers: true }, true],
    [
      "/t.x.@derivative.@abs.@degrees",
      { supportsMathModifiers: true, supportsStreamModifiers: true },
      false,
    ],
    [
      "/t.x.@derivative.@length",
      { supportsMathModifiers: true, supportsStreamModifiers: true },
      true,
    ],
    ["/t.x.@delta.@integral", { supportsMathModifiers: true, supportsStreamModifiers: true }, true],
  ])("flags %s as invalid with %p: %p", (path, props, invalid) => {
    mockTopics = [{ name: "/t", schemaName: "msg" }];
    mockDatatypes = new Map([["msg", { definitions: [{ name: "x", type: "float64" }] }]]);

    renderComponent({ path, ...props });

    expect(screen.getByTestId("autocomplete-textfield").className.includes("inputError")).toBe(
      invalid,
    );
  });

  describe("autoComplete logic", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (useGlobalVariables as Mock).mockReturnValue({
        globalVariables: {},
        setGlobalVariables: vi.fn(),
      });
    });

    it("should resolve to 'topicName' when path is empty (rosPath is null)", async () => {
      // Given
      const topic1 = { name: `/${BasicBuilder.string()}`, schemaName: "std_msgs/String" };
      const topic2 = { name: `/${BasicBuilder.number()}`, schemaName: "std_msgs/Int32" };
      mockTopics = [topic1, topic2];
      mockDatatypes = new Map();

      // When
      renderComponent({ path: "" });
      const input = screen.getByRole("combobox");
      fireEvent.click(input);
      fireEvent.focus(input);

      // Then
      // Wait for autocomplete options to appear
      const options = await screen.findAllByRole("option");
      expect(options).toHaveLength(2);
      expect(options[0]!.textContent).toBe(topic1.name);
      expect(options[1]!.textContent).toBe(topic2.name);
    });

    it("should resolve to 'topicName' when typing partial topic name", async () => {
      const topic1 = { name: `/camera/${BasicBuilder.string()}`, schemaName: "std_msgs/String" };
      const topic2 = { name: `/camera/${BasicBuilder.string()}`, schemaName: "std_msgs/String" };
      mockTopics = [topic1, topic2];
      mockDatatypes = new Map();

      renderComponent({ path: "/cam" });
      const input = screen.getByRole("combobox");

      fireEvent.click(input);
      fireEvent.focus(input);

      // Wait for options to appear, then verify them by text content
      const options = await screen.findAllByRole("option");
      expect(options).toHaveLength(2);
      expect(options[0]!.textContent).toBe(topic1.name);
      expect(options[1]!.textContent).toBe(topic2.name);
    });

    it("should show field options after selecting a topic from autocomplete", async () => {
      // Given
      mockTopics = [{ name: `/topic1`, schemaName: "custom/Type" }];
      mockDatatypes = new Map([
        [
          "custom/Type",
          {
            definitions: [
              { name: "value1", type: "float64", isArray: false, isComplex: false },
              { name: "value2", type: "string", isArray: false, isComplex: false },
            ],
          },
        ],
      ]);

      renderComponent({ path: "/topic1.", validTypes: ["primitive"] });
      const input = screen.getByRole("combobox");
      // When/Then
      fireEvent.click(input);
      fireEvent.focus(input);
      // Then
      const options = await screen.findAllByRole("option");
      expect(options).toHaveLength(2);
      expect(options[0]!.textContent).toBe(".value1");
      expect(options[1]!.textContent).toBe(".value2");
    });
  });
});
