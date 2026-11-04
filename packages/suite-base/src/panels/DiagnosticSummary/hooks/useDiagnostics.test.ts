/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import { renderHook } from "@testing-library/react";

import * as PanelAPI from "@lichtblick/suite-base/PanelAPI";
import {
  DiagnosticStatusArrayMsg,
  DiagnosticStatusMessage,
} from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { getDiagnosticId } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/util";
import DiagnosticsBuilder from "@lichtblick/suite-base/testing/builders/DiagnosticsBuilder";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

import useDiagnostics, { addMessages, DiagnosticsState } from "./useDiagnostics";

vi.mock("@lichtblick/suite-base/PanelAPI");

const empty = (): DiagnosticsState => ({ latest: new Map(), history: new Map() });

function event(status: DiagnosticStatusMessage[], sec: number, topic = "/diagnostics") {
  return MessageEventBuilder.messageEvent<DiagnosticStatusArrayMsg>({
    topic,
    receiveTime: { sec, nsec: 0 },
    message: DiagnosticsBuilder.statusArrayMsg({
      header: DiagnosticsBuilder.header({ stamp: { sec: 0, nsec: 0 } }),
      status,
    }),
  });
}

describe("addMessages", () => {
  it("keeps the latest status per id with receive time and topic", () => {
    const status = DiagnosticsBuilder.statusMessage({ level: LEVELS.OK });
    const id = getDiagnosticId(status.hardware_id, status.name);

    const result = addMessages(
      empty(),
      [event([status], 1, "/a"), event([{ ...status, level: LEVELS.ERROR }], 2, "/a")],
      5,
    );

    expect(result.latest.size).toBe(1);
    const info = result.latest.get(id)!;
    expect(info.status.level).toBe(LEVELS.ERROR);
    expect(info.receiveTime).toEqual({ sec: 2, nsec: 0 });
    expect(info.topic).toBe("/a");
    expect(result.history.get(id)).toEqual({
      changes: [
        { t: 1, level: LEVELS.OK },
        { t: 2, level: LEVELS.ERROR },
      ],
      lastSeen: 2,
    });
  });

  it("merges statuses from several topics", () => {
    const a = DiagnosticsBuilder.statusMessage();
    const b = DiagnosticsBuilder.statusMessage();
    const result = addMessages(empty(), [event([a], 1, "/a"), event([b], 1, "/b")], 5);
    expect(result.latest.size).toBe(2);
  });

  it("never mutates the previous state", () => {
    const status = DiagnosticsBuilder.statusMessage({ level: LEVELS.OK });
    const id = getDiagnosticId(status.hardware_id, status.name);
    const first = addMessages(empty(), [event([status], 1)], 5);
    const firstInfo = first.latest.get(id);
    const firstHistory = first.history.get(id);

    const second = addMessages(first, [event([{ ...status, level: LEVELS.WARN }], 2)], 5);

    expect(second).not.toBe(first);
    expect(first.latest.get(id)).toBe(firstInfo);
    expect(first.history.get(id)).toBe(firstHistory);
    expect(firstHistory?.changes).toHaveLength(1);
  });

  it("returns the same state when no statuses arrive", () => {
    const state = addMessages(empty(), [event([DiagnosticsBuilder.statusMessage()], 1)], 5);
    expect(addMessages(state, [], 5)).toBe(state);
    expect(addMessages(state, [event([], 2)], 5)).toBe(state);
  });

  it("ignores out-of-order messages for latest and history", () => {
    const status = DiagnosticsBuilder.statusMessage({ level: LEVELS.OK });
    const id = getDiagnosticId(status.hardware_id, status.name);
    const result = addMessages(
      empty(),
      [event([status], 5), event([{ ...status, level: LEVELS.ERROR }], 3)],
      5,
    );
    expect(result.latest.get(id)?.status.level).toBe(LEVELS.OK);
    expect(result.latest.get(id)?.receiveTime).toEqual({ sec: 5, nsec: 0 });
    expect(result.history.get(id)?.lastSeen).toBe(5);
    expect(result.history.get(id)?.changes).toEqual([{ t: 5, level: LEVELS.OK }]);
  });
});

describe("useDiagnostics", () => {
  const useMessageReducerMock = PanelAPI.useMessageReducer as Mock;

  it("subscribes to the given topics and restores to an empty state", () => {
    const topics = [BasicBuilder.string(), BasicBuilder.string()];
    useMessageReducerMock.mockImplementation(({ restore }) => restore());

    const { result } = renderHook(() => useDiagnostics(topics, 5));

    expect(useMessageReducerMock).toHaveBeenCalledWith(
      expect.objectContaining({ topics, restore: expect.any(Function) }),
    );
    expect(result.current).toEqual(empty());
  });

  it("keeps the state when the reducer changes", () => {
    let restore: (prev?: DiagnosticsState) => DiagnosticsState = () => empty();
    useMessageReducerMock.mockImplementation((props) => {
      restore = props.restore;
      return props.restore();
    });
    renderHook(() => useDiagnostics([], 5));
    const prev = empty();
    expect(restore(prev)).toBe(prev);
  });
});
