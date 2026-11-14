/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";
import { PropsWithChildren } from "react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import { MessageEvent, Topic } from "@lichtblick/suite-base/players/types";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import { usePathSampleHistory } from "./usePathSampleHistory";

const topics: Topic[] = [{ name: "/state", schemaName: "test/State" }];
const datatypes: RosDatatypes = new Map([
  ["test/State", { definitions: [{ name: "mode", type: "int32" }] }],
]);

const message = (mode: number, sec: number): MessageEvent => ({
  topic: "/state",
  schemaName: "test/State",
  receiveTime: { sec, nsec: 0 },
  sizeInBytes: 0,
  message: { mode },
});

function setup(historySize: number) {
  let messages: MessageEvent[] = [];
  let lastSeekTime = 1;
  const wrapper = ({ children }: PropsWithChildren) => (
    <MockCurrentLayoutProvider>
      <MockMessagePipelineProvider
        topics={topics}
        datatypes={datatypes}
        messages={messages}
        activeData={{ lastSeekTime }}
      >
        {children}
      </MockMessagePipelineProvider>
    </MockCurrentLayoutProvider>
  );
  const hook = renderHook(() => usePathSampleHistory(["/state.mode"], historySize), { wrapper });
  const values = () => hook.result.current["/state.mode"]?.toArray().map((sample) => sample.value);
  return {
    values,
    hook,
    send: (...next: MessageEvent[]) => {
      messages = next;
      hook.rerender();
    },
    seek: () => {
      lastSeekTime++;
      messages = [];
      hook.rerender();
    },
  };
}

describe("usePathSampleHistory", () => {
  it("keeps the decoded values of the newest messages, not the messages", () => {
    const { send, values, hook } = setup(2);
    send(message(1, 1));
    send(message(2, 2), message(3, 3));

    expect(values()).toEqual([2, 3]);
    const last = hook.result.current["/state.mode"]?.last();
    expect(last).toEqual({
      receiveTime: { sec: 3, nsec: 0 },
      headerStamp: undefined,
      count: 1,
      value: 3,
      constantName: undefined,
    });
    expect(last).not.toHaveProperty("messageEvent");
  });

  it("starts over after a seek", () => {
    const { send, seek, values } = setup(10);
    send(message(1, 1));
    seek();
    expect(values()).toEqual([]);
  });

  it("rejects an unbounded history", () => {
    expect(() => setup(Infinity)).toThrow(RangeError);
  });
});
