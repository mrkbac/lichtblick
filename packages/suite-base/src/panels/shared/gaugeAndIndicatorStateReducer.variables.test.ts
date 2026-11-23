// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { MessageEvent } from "@lichtblick/suite";
import { GaugeAndIndicatorState } from "@lichtblick/suite-base/panels/shared/types";

import { stateReducer } from "./gaugeAndIndicatorStateReducer";

const message = (): MessageEvent => ({
  topic: "/data",
  schemaName: "Data",
  receiveTime: { sec: 0, nsec: 0 },
  sizeInBytes: 0,
  message: { items: [10, 20, 30] },
});

describe("stateReducer with $variables", () => {
  it("applies variable changes made after the path was set", () => {
    let state: GaugeAndIndicatorState = {
      globalVariables: undefined,
      path: "",
      parsedPath: undefined,
      latestMessage: undefined,
      latestMatchingQueriedData: undefined,
      pathParseError: undefined,
      error: undefined,
    };
    // Path is set at mount, before any variables arrive
    state = stateReducer(state, { type: "path", path: "/data.items[$i]" });
    state = stateReducer(state, { type: "updateGlobalVariables", globalVariables: { i: 1 } });
    state = stateReducer(state, { type: "frame", messages: [message()] });
    expect(state.latestMatchingQueriedData).toBe(20);

    // A later variable change re-evaluates the last message without waiting for a new one
    state = stateReducer(state, { type: "updateGlobalVariables", globalVariables: { i: 2 } });
    expect(state.latestMatchingQueriedData).toBe(30);
  });
});
