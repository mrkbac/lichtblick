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

import { renderHook } from "@testing-library/react";
import * as _ from "lodash-es";

import { OperatorType, parseMessagePath } from "@lichtblick/message-path";
import { messagePathStructures } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import { MessageEvent, Topic } from "@lichtblick/suite-base/players/types";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";

import {
  fillInGlobalVariablesInPath,
  getMessagePathDataItems,
  useCachedGetMessagePathDataItems,
} from "./useCachedGetMessagePathDataItems";

function addValuesWithPathsToItems(
  messages: MessageEvent[],
  messagePath: string,
  providerTopics: Topic[],
  datatypes: RosDatatypes,
) {
  return messages.map((message) => {
    const rosPath = parseMessagePath(messagePath);
    if (!rosPath) {
      return undefined;
    }
    const topicsByName = _.keyBy(providerTopics, ({ name }) => name);
    const structures = messagePathStructures(datatypes);
    const enums = enumValuesByDatatypeAndField(datatypes);
    const items = getMessagePathDataItems(message, rosPath, topicsByName, structures, enums);
    return items?.map(({ value, path, constantName }) => ({
      value,
      path,
      constantName,
    }));
  });
}

describe("useCachedGetMessagePathDataItems", () => {
  it("supports types with reference cycles (i.e. reference themselves within their children)", () => {
    const topics: Topic[] = [{ name: "/topic", schemaName: "datatype" }];
    const datatypes: RosDatatypes = new Map(
      Object.entries({
        datatype: {
          definitions: [
            { name: "field", type: "uint32", isComplex: false },
            { name: "self", type: "datatype", isComplex: true },
          ],
        },
      }),
    );

    const { result } = renderHook(
      () => useCachedGetMessagePathDataItems(["/topic", "/topic.self"]),
      {
        wrapper: function Wrapper({ children }) {
          return (
            <MockCurrentLayoutProvider>
              <MockMessagePipelineProvider topics={topics} datatypes={datatypes}>
                {children}
              </MockMessagePipelineProvider>
            </MockCurrentLayoutProvider>
          );
        },
      },
    );

    const message: MessageEvent = {
      topic: "/topic",
      receiveTime: { sec: 0, nsec: 0 },
      message: { field: 0, self: { field: 1 } },
      schemaName: "datatype",
      sizeInBytes: 0,
    };

    expect(result.current("/topic", message)).toEqual([
      { constantName: undefined, path: "/topic", value: { field: 0, self: { field: 1 } } },
    ]);

    expect(result.current("/topic.self", message)).toEqual([
      { constantName: undefined, path: "/topic.self", value: { field: 1 } },
    ]);
  });

  describe("getMessagePathDataItems", () => {
    it("applies modifiers and includes them in the item path", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { point: { x: 3, y: 4 } },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          some_datatype: { definitions: [{ name: "point", type: "point_datatype" }] },
          point_datatype: {
            definitions: [
              { name: "x", type: "float64" },
              { name: "y", type: "float64" },
            ],
          },
        }),
      );

      expect(
        addValuesWithPathsToItems(messages, "/some/topic.point.@norm.@mul(2)", topics, datatypes),
      ).toEqual([
        [{ value: 10, path: "/some/topic.point.@norm.@mul(2)", constantName: undefined }],
      ]);
    });

    it("traverses down the path for every item", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { some_array: [{ some_id: 10, some_message: { x: 10, y: 20 } }] },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: {
            some_array: [
              { some_id: 10, some_message: { x: 10, y: 20 } },
              { some_id: 50, some_message: { x: 50, y: 60 } },
            ],
          },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          some_datatype: {
            definitions: [{ name: "some_array", type: "some_other_datatype", isArray: true }],
          },
          some_other_datatype: {
            definitions: [
              { name: "some_id", type: "uint32" },
              { name: "some_message", type: "yet_another_datatype" },
            ],
          },
          yet_another_datatype: {
            definitions: [
              { name: "x", type: "uint32" },
              { name: "y", type: "uint32" },
            ],
          },
        }),
      );

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic.some_array[:].some_message",
          topics,
          datatypes,
        ),
      ).toEqual([
        [
          {
            value: { x: 10, y: 20 },
            path: "/some/topic.some_array[0].some_message",
            constantName: undefined,
          },
        ],
        [
          {
            value: { x: 10, y: 20 },
            path: "/some/topic.some_array[0].some_message",
            constantName: undefined,
          },
          {
            value: { x: 50, y: 60 },
            path: "/some/topic.some_array[1].some_message",
            constantName: undefined,
          },
        ],
      ]);
    });

    it("returns items even when a schema is not available", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { some_num: 1, some_array: [{ some_id: 10, some_message: { x: 10, y: 20 } }] },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: {
            some_num: 2,
            some_array: [
              { some_id: 10, some_message: { x: 10, y: 20 } },
              { some_id: 50, some_message: { x: 50, y: 60 } },
            ],
          },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: undefined }];
      const datatypes: RosDatatypes = new Map();

      expect(
        addValuesWithPathsToItems(messages, "/some/topic.some_num", topics, datatypes),
      ).toEqual([
        [
          {
            value: 1,
            path: "/some/topic.some_num",
            constantName: undefined,
          },
        ],
        [
          {
            value: 2,
            path: "/some/topic.some_num",
            constantName: undefined,
          },
        ],
      ]);
      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic.some_array[:].some_message",
          topics,
          datatypes,
        ),
      ).toEqual([
        [
          {
            value: { x: 10, y: 20 },
            path: "/some/topic.some_array[0].some_message",
            constantName: undefined,
          },
        ],
        [
          {
            value: { x: 10, y: 20 },
            path: "/some/topic.some_array[0].some_message",
            constantName: undefined,
          },
          {
            value: { x: 50, y: 60 },
            path: "/some/topic.some_array[1].some_message",
            constantName: undefined,
          },
        ],
      ]);
    });

    it("works with negative slices", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { some_array: [1, 2, 3, 4, 5] },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          some_datatype: { definitions: [{ name: "some_array", type: "int32", isArray: true }] },
        }),
      );

      expect(
        addValuesWithPathsToItems(messages, "/some/topic.some_array[-2:-1]", topics, datatypes),
      ).toEqual([
        [
          { constantName: undefined, path: "/some/topic.some_array[-2]", value: 4 },
          { constantName: undefined, path: "/some/topic.some_array[-1]", value: 5 },
        ],
      ]);
    });

    it.each([
      ["[-3:]", [3, 4, 5]],
      ["[1:-2]", [2, 3, 4]],
      ["[-10:1]", [1, 2]],
      ["[3:1]", []],
    ])("normalizes negative and out-of-range slice %s", (slice, expected) => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { some_array: [1, 2, 3, 4, 5] },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          some_datatype: { definitions: [{ name: "some_array", type: "int32", isArray: true }] },
        }),
      );

      const items = addValuesWithPathsToItems(
        messages,
        `/some/topic.some_array${slice}`,
        topics,
        datatypes,
      );
      expect(items[0]!.map((item) => item.value)).toEqual(expected);
    });

    it("returns nothing for invalid topics", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { value: 1 },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      // Topic not present
      expect(addValuesWithPathsToItems(messages, "/some/topic", [], new Map())).toEqual([
        undefined,
      ]);
    });

    it("handles fields inside times", () => {
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "std_msgs/Header" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          "std_msgs/Header": { definitions: [{ name: "stamp", type: "time", isArray: false }] },
        }),
      );
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { stamp: { sec: 1, nsec: 2 } },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      expect(
        addValuesWithPathsToItems(messages, "/some/topic.stamp.nsec", topics, datatypes),
      ).toEqual([[{ constantName: undefined, path: "/some/topic.stamp.nsec", value: 2 }]]);
    });

    it("filters properly, and uses the filter name in the path", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: {
            some_array: [
              {
                some_filter_value: 0,
                some_id: 10,
              },
              {
                some_filter_value: 1,
                some_id: 50,
              },
            ],
          },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          some_datatype: {
            definitions: [
              {
                name: "some_array",
                type: "some_other_datatype",
                isArray: true,
              },
            ],
          },
          some_other_datatype: {
            definitions: [
              {
                name: "some_filter_value",
                type: "uint32",
              },
              {
                name: "some_id",
                type: "uint32",
              },
            ],
          },
        }),
      );

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic.some_array[:]{some_filter_value==0}.some_id",
          topics,
          datatypes,
        ),
      ).toEqual([
        [
          {
            constantName: undefined,
            value: 10,
            path: "/some/topic.some_array[:]{some_filter_value==0}.some_id",
          },
        ],
      ]);
    });

    it("filters entire messages", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: {
            str_field: "A",
            num_field: 1,
          },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: {
            str_field: "A",
            num_field: 2,
          },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: {
            str_field: "B",
            num_field: 2,
          },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          some_datatype: {
            definitions: [
              {
                name: "str_field",
                type: "string",
              },
              {
                name: "num_field",
                type: "uint32",
              },
            ],
          },
        }),
      );

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic{str_field=='A'}.num_field",
          topics,
          datatypes,
        ),
      ).toEqual([
        [{ value: 1, path: "/some/topic{str_field=='A'}.num_field" }],
        [{ value: 2, path: "/some/topic{str_field=='A'}.num_field" }],
        [],
      ]);

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic{str_field=='B'}.num_field",
          topics,
          datatypes,
        ),
      ).toEqual([[], [], [{ value: 2, path: "/some/topic{str_field=='B'}.num_field" }]]);

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic{num_field==2}.num_field",
          topics,
          datatypes,
        ),
      ).toEqual([
        [],
        [{ value: 2, path: "/some/topic{num_field==2}.num_field" }],
        [{ value: 2, path: "/some/topic{num_field==2}.num_field" }],
      ]);

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic{str_field=='A'}{num_field==2}.num_field",
          topics,
          datatypes,
        ),
      ).toEqual([
        [],
        [{ value: 2, path: "/some/topic{str_field=='A'}{num_field==2}.num_field" }],
        [],
      ]);

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic{str_field=='C'}.num_field",
          topics,
          datatypes,
        ),
      ).toEqual([[], [], []]);
    });

    it("returns matching constants", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: {
            state: 0,
          },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: {
            state: 1,
          },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          some_datatype: {
            definitions: [
              {
                name: "OFF",
                type: "uint32",
                isConstant: true,
                value: 0,
              },
              {
                name: "ON",
                type: "uint32",
                isConstant: true,
                value: 1,
              },
              {
                name: "state",
                type: "uint32",
              },
            ],
          },
        }),
      );

      expect(addValuesWithPathsToItems(messages, "/some/topic.state", topics, datatypes)).toEqual([
        [
          {
            value: 0,
            path: "/some/topic.state",
            constantName: "OFF",
          },
        ],
        [
          {
            value: 1,
            path: "/some/topic.state",
            constantName: "ON",
          },
        ],
      ]);
    });

    it("filters correctly with bigints", () => {
      const messages: MessageEvent[] = [
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { str_field: "A", num_field: 18446744073709551616n },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
        {
          topic: "/some/topic",
          receiveTime: { sec: 0, nsec: 0 },
          message: { str_field: "B", num_field: 18446744073709552020n },
          schemaName: "datatype",
          sizeInBytes: 0,
        },
      ];
      const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
      const datatypes: RosDatatypes = new Map(
        Object.entries({
          some_datatype: {
            definitions: [{ name: "num_field", type: "uint64" }],
          },
        }),
      );

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic{num_field==18446744073709551616}.num_field",
          topics,
          datatypes,
        ),
      ).toEqual([
        [
          {
            value: 18446744073709551616n,
            path: "/some/topic{num_field==18446744073709551616}.num_field",
          },
        ],
        [],
      ]);

      expect(
        addValuesWithPathsToItems(
          messages,
          "/some/topic{num_field==18446744073709552020}.num_field",
          topics,
          datatypes,
        ),
      ).toEqual([
        [],
        [
          {
            value: 18446744073709552020n,
            path: "/some/topic{num_field==18446744073709552020}.num_field",
          },
        ],
      ]);
    });
  });
});

describe("fillInGlobalVariablesInPath", () => {
  const equal: OperatorType = "==";
  const notEqual: OperatorType = "!=";

  it("fills in global variables in modifier arguments", () => {
    const filled = fillInGlobalVariablesInPath(
      {
        topicName: "/foo",
        topicNameRepr: "/foo",
        messagePath: [
          {
            type: "modifier",
            name: "mul",
            args: [
              2,
              ["width"],
              { variableName: "scale", startLoc: 0 },
              { variableName: "x", startLoc: 0 },
            ],
            repr: "mul(2, width, $scale, $x)",
          },
        ],
      },
      { scale: 1.5, x: "not a number" },
    );
    expect(filled.messagePath[0]).toEqual(
      expect.objectContaining({ args: [2, ["width"], 1.5, NaN] }),
    );
  });

  it("fills in global variables in slices", () => {
    expect(
      fillInGlobalVariablesInPath(
        {
          topicName: "/foo",
          topicNameRepr: "/foo",
          messagePath: [
            { type: "name", name: "bar", repr: "bar" },
            {
              type: "slice",
              start: { variableName: "start", startLoc: 0 },
              end: { variableName: "end", startLoc: 0 },
            },
          ],
          modifier: undefined,
        },
        { start: 10, end: "123" },
      ),
    ).toEqual({
      topicName: "/foo",
      topicNameRepr: "/foo",
      messagePath: [
        { name: "bar", type: "name", repr: "bar" },
        { type: "slice", start: 10, end: 123 },
      ],
    });

    // Non-numbers
    expect(
      fillInGlobalVariablesInPath(
        {
          topicName: "/foo",
          topicNameRepr: "/foo",
          messagePath: [
            { type: "name", name: "bar", repr: "bar" },
            {
              type: "slice",
              start: { variableName: "start", startLoc: 0 },
              end: { variableName: "end", startLoc: 0 },
            },
          ],
          modifier: undefined,
        },
        { end: "blah" },
      ),
    ).toEqual({
      topicName: "/foo",
      topicNameRepr: "/foo",
      messagePath: [
        { type: "name", name: "bar", repr: "bar" },
        { type: "slice", start: 0, end: Infinity },
      ],
    });
  });

  it("fills in global variables in filters", () => {
    expect(
      fillInGlobalVariablesInPath(
        {
          topicName: "/foo",
          topicNameRepr: "/foo",
          messagePath: [
            {
              type: "filter",
              path: ["bar"],
              value: { variableName: "var", startLoc: 0 },
              nameLoc: 0,
              valueLoc: 0,
              repr: "",
              operator: equal,
            },
          ],
          modifier: undefined,
        },
        { var: 123 },
      ),
    ).toEqual({
      topicName: "/foo",
      topicNameRepr: "/foo",
      messagePath: [
        {
          type: "filter",
          path: ["bar"],
          value: 123,
          nameLoc: 0,
          valueLoc: 0,
          repr: "",
          operator: equal,
        },
      ],
    });
  });

  // This test captures current behavior, but in the future we might want to add support for boolean values.
  // Like the literal `{bar==true}`
  it("fills in boolean values", () => {
    expect(
      fillInGlobalVariablesInPath(
        {
          topicName: "/foo",
          topicNameRepr: "/foo",
          messagePath: [
            {
              type: "filter",
              path: ["bar"],
              value: { variableName: "var", startLoc: 0 },
              nameLoc: 0,
              valueLoc: 0,
              repr: "",
              operator: notEqual,
            },
          ],
          modifier: undefined,
        },
        { var: true },
      ),
    ).toEqual({
      topicName: "/foo",
      topicNameRepr: "/foo",
      messagePath: [
        {
          type: "filter",
          path: ["bar"],
          value: true,
          nameLoc: 0,
          valueLoc: 0,
          repr: "",
          operator: notEqual,
        },
      ],
    });
  });
});
