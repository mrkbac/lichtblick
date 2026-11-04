/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook, waitFor } from "@testing-library/react";

import { SubscribeMessageRangeArgs } from "@lichtblick/suite";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { DiagnosticStatusArrayMsg } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { getDiagnosticId } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/util";
import { MessageEvent } from "@lichtblick/suite-base/players/types";
import DiagnosticsBuilder from "@lichtblick/suite-base/testing/builders/DiagnosticsBuilder";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";

import { useDiagnosticHistory } from "./useDiagnosticHistory";

vi.mock("@lichtblick/suite-base/components/PanelExtensionAdapter", () => ({
  useSubscribeMessageRange: vi.fn(),
}));

const status = DiagnosticsBuilder.statusMessage({ hardware_id: "motor", name: "temp" });
const id = getDiagnosticId("motor", "temp");

const event = (sec: number, level: number): MessageEvent =>
  MessageEventBuilder.messageEvent<DiagnosticStatusArrayMsg>({
    receiveTime: { sec, nsec: 0 },
    message: DiagnosticsBuilder.statusArrayMsg({ status: [{ ...status, level }] }),
  });

describe("useDiagnosticHistory", () => {
  it("builds level changes over the whole range, with stale gaps", async () => {
    const cancel = vi.fn();
    const subscribe = vi.fn((args: SubscribeMessageRangeArgs) => {
      void args.onNewRangeIterator(
        (async function* () {
          yield [event(0, LEVELS.OK), event(1, LEVELS.OK)];
          yield [event(2, LEVELS.ERROR), event(20, LEVELS.ERROR)];
        })(),
      );
      return cancel;
    });
    (useSubscribeMessageRange as vi.Mock).mockReturnValue(subscribe);
    const topics = ["/diagnostics"];

    const { result, unmount } = renderHook(() => useDiagnosticHistory(topics, 5));

    await waitFor(() => {
      expect(result.current?.get(id)).toEqual({
        changes: [
          { t: 0, level: LEVELS.OK },
          { t: 2, level: LEVELS.ERROR },
          { t: 7, level: LEVELS.STALE },
          { t: 20, level: LEVELS.ERROR },
        ],
        lastSeen: 20,
      });
    });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ topic: "/diagnostics" }));

    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it("stays undefined when the source has no message range", () => {
    (useSubscribeMessageRange as vi.Mock).mockReturnValue(() => () => {});
    const topics = ["/diagnostics"];
    const { result } = renderHook(() => useDiagnosticHistory(topics, 5));
    expect(result.current).toBeUndefined();
  });
});
