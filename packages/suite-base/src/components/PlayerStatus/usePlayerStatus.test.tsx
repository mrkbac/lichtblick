/** @vitest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import MockMessagePipelineProvider from "@lichtblick/suite-base/components/MessagePipeline/MockMessagePipelineProvider";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { PlayerAlert, PlayerPresence } from "@lichtblick/suite-base/players/types";

import { PlayerStatusKind, usePlayerStatus } from "./usePlayerStatus";

const failed: PlayerAlert = { severity: "error", message: "Connection failed" };

function statusOf(props: {
  presence: PlayerPresence;
  live?: boolean;
  liveHistory?: boolean;
  noActiveData?: boolean;
  alerts?: PlayerAlert[];
}): { kind: PlayerStatusKind; error?: PlayerAlert } {
  const { result } = renderHook(usePlayerStatus, {
    wrapper: ({ children }) => (
      <MockMessagePipelineProvider
        name="ws://robot.example:8765"
        presence={props.presence}
        capabilities={
          props.liveHistory === true
            ? [PLAYER_CAPABILITIES.playbackControl, PLAYER_CAPABILITIES.liveHistory]
            : props.live === true
              ? []
              : [PLAYER_CAPABILITIES.playbackControl]
        }
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
    // a live source with seekable history is still live
    [{ presence: PlayerPresence.PRESENT, liveHistory: true }, "live"],
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
