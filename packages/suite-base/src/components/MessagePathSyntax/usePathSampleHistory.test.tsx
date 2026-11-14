/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import { PropsWithChildren } from "react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";
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

function setup(historySize: number, path = "/state.mode") {
  let messages: MessageEvent[] = [];
  const setSubscriptions = vi.fn();
  let lastSeekTime = 1;
  const wrapper = ({ children }: PropsWithChildren) => (
    <MockCurrentLayoutProvider>
      <MockMessagePipelineProvider
        topics={topics}
        datatypes={datatypes}
        messages={messages}
        activeData={{ lastSeekTime }}
        setSubscriptions={setSubscriptions}
      >
        {children}
      </MockMessagePipelineProvider>
    </MockCurrentLayoutProvider>
  );
  const hook = renderHook(
    () => ({
      history: usePathSampleHistory([path], historySize),
      setGlobalVariables: useGlobalVariables().setGlobalVariables,
    }),
    { wrapper },
  );
  const values = () => hook.result.current.history[path]?.toArray().map((sample) => sample.value);
  return {
    values,
    hook,
    setSubscriptions,
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
    const last = hook.result.current.history["/state.mode"]?.last();
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

  it("keeps the header of field-projected messages for header stamps", () => {
    const { setSubscriptions } = setup(10);
    expect(setSubscriptions).toHaveBeenLastCalledWith(expect.any(String), [
      expect.objectContaining({ topic: "/state", fields: ["mode", "header"] }),
    ]);
  });

  it("starts paths using variables over when the variables change", () => {
    const { send, values, hook } = setup(10, "/state{mode>$min}.mode");
    act(() => {
      hook.result.current.setGlobalVariables({ min: 0 });
    });
    send(message(1, 1), message(2, 2));
    expect(values()).toEqual([1, 2]);

    act(() => {
      hook.result.current.setGlobalVariables({ min: 1 });
    });
    send(message(3, 3));
    expect(values()).toEqual([3]);
  });

  it("rejects an unbounded history", () => {
    expect(() => setup(Infinity)).toThrow(RangeError);
  });
});
