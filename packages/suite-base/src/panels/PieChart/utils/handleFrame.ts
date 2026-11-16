// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";

import { toPieValues } from "./toPieValues";
import type { PieChartState, PieChartAction } from "../types";

export type HandleFrameProps = {
  state: PieChartState;
  action: Extract<PieChartAction, { type: "frame" }>;
};

export function handleFrame({ state, action }: HandleFrameProps): PieChartState {
  if (state.pathParseError != undefined) {
    return { ...state, latestMessage: action.messages.at(-1), error: undefined };
  }
  let latestMatchingQueriedData = state.latestMatchingQueriedData;
  let latestMessage = state.latestMessage;
  let error = state.error;

  if (state.parsedPath) {
    for (const message of action.messages) {
      if (message.topic !== state.parsedPath.topicName) {
        continue;
      }

      try {
        latestMatchingQueriedData = toPieValues(
          simpleGetMessagePathDataItems(message, state.parsedPath),
        );
        latestMessage = message;
        error = undefined;
      } catch (err) {
        // Don't keep drawing an older message's slices next to this message's error
        latestMatchingQueriedData = undefined;
        latestMessage = message;
        error = err instanceof Error ? err : new Error("Unknown error processing message data");
      }
    }
  }

  return { ...state, latestMessage, latestMatchingQueriedData, error };
}
