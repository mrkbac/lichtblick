/** @vitest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import { PlayerAlert, PlayerPresence } from "@lichtblick/suite-base/players/types";

import { PlayerStatusKind, shortSourceName, usePlayerStatus } from "./usePlayerStatus";

const seek = () => {};
const failed: PlayerAlert = { severity: "error", message: "Connection failed" };

function statusOf(props: {
  presence: PlayerPresence;
  live?: boolean;
  noActiveData?: boolean;
  alerts?: PlayerAlert[];
}): { kind: PlayerStatusKind; error?: PlayerAlert } {
  const { result } = renderHook(usePlayerStatus, {
    wrapper: ({ children }) => (
      <MockMessagePipelineProvider
        name="ws://robot.example:8765"
        presence={props.presence}
        seekPlayback={props.live === true ? undefined : seek}
        noActiveData={props.noActiveData}
        alerts={props.alerts}
      >
        {children}
      </MockMessagePipelineProvider>
    ),
  });
  return result.current;
}

describe("usePlayerStatus", () => {
  it.each([
    [{ presence: PlayerPresence.NOT_PRESENT }, "none"],
    [{ presence: PlayerPresence.INITIALIZING, live: true }, "connecting"],
    [{ presence: PlayerPresence.INITIALIZING }, "opening"],
    // a recording without a current time is still reading its first data
    [{ presence: PlayerPresence.PRESENT, noActiveData: true }, "loading"],
    [{ presence: PlayerPresence.BUFFERING, noActiveData: true }, "loading"],
    // a later seek buffers with a current time: not the first load
    [{ presence: PlayerPresence.BUFFERING }, "ready"],
    [{ presence: PlayerPresence.PRESENT }, "ready"],
    [{ presence: PlayerPresence.PRESENT, live: true, noActiveData: true }, "live"],
    [{ presence: PlayerPresence.RECONNECTING, live: true }, "reconnecting"],
    [{ presence: PlayerPresence.ERROR }, "failed"],
  ] as const)("%o → %s", (props, kind) => {
    expect(statusOf(props).kind).toBe(kind);
  });

  it("carries the error that explains a failure", () => {
    const status = statusOf({
      presence: PlayerPresence.RECONNECTING,
      live: true,
      alerts: [failed],
    });
    expect(status.error).toEqual(failed);
  });
});

describe("shortSourceName", () => {
  it.each([
    ["https://example.com/data/run%201.mcap", "run 1.mcap"],
    ["ws://robot.example:8765\nserver", "robot.example:8765"],
    ["example.mcap", "example.mcap"],
    [undefined, undefined],
  ])("%s → %s", (name, expected) => {
    expect(shortSourceName(name)).toBe(expected);
  });
});
