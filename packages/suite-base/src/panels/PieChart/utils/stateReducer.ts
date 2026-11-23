// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

import { parseMessagePath } from "@lichtblick/message-path";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { toError } from "@lichtblick/suite-base/util/toError";

import { toPieValues } from "./toPieValues";
import type { PieChartState, PieChartAction } from "../types";

export function stateReducer(state: PieChartState, action: PieChartAction): PieChartState {
  switch (action.type) {
    case "frame": {
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
    case "path": {
      let newPath;
      let pathParseError: string | undefined;
      let error: Error | undefined;

      try {
        newPath = parseMessagePath(action.path);
        if (
          newPath?.messagePath.some(
            (part) =>
              (part.type === "filter" && typeof part.value === "object") ||
              (part.type === "modifier" &&
                part.args.some((arg) => typeof arg === "object" && "variableName" in arg)) ||
              (part.type === "slice" &&
                (typeof part.start === "object" || typeof part.end === "object")),
          ) ??
          false
        ) {
          pathParseError = "Message paths using variables are not currently supported";
        }
      } catch (err: unknown) {
        error = toError(err);
        newPath = undefined;
      }

      let latestMatchingQueriedData: Float32Array | undefined;
      if (newPath && pathParseError == undefined && state.latestMessage) {
        try {
          latestMatchingQueriedData = toPieValues(
            simpleGetMessagePathDataItems(state.latestMessage, newPath),
          );
        } catch (err: unknown) {
          error = toError(err);
        }
      }

      return {
        ...state,
        path: action.path,
        parsedPath: newPath,
        latestMatchingQueriedData,
        error,
        pathParseError,
      };
    }
    case "seek":
      return {
        ...state,
        latestMessage: undefined,
        latestMatchingQueriedData: undefined,
        error: undefined,
      };
    default:
      return state;
  }
}
