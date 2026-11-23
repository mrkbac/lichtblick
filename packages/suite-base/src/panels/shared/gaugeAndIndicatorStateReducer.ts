// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { MessagePath, parseMessagePath } from "@lichtblick/message-path";
import { MessageEvent } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { fillInGlobalVariablesInPath } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  GaugeAndIndicatorState,
  GaugeAndIndicatorAction,
} from "@lichtblick/suite-base/panels/shared/types";
import { toError } from "@lichtblick/suite-base/util/toError";

export function getSingleDataItem(results: unknown[]): unknown {
  if (results.length <= 1) {
    return results[0];
  }
  throw new Error("Message path produced multiple results");
}

function handleFrameActionState({
  messages,
  state,
}: {
  messages: readonly MessageEvent[];
  state: GaugeAndIndicatorState;
}): GaugeAndIndicatorState {
  if (!state.parsedPath) {
    return { ...state, error: undefined };
  }
  const filledInPath = fillInGlobalVariablesInPath(state.parsedPath, state.globalVariables ?? {});
  let latestMatchingQueriedData = state.latestMatchingQueriedData;
  let latestMessage = state.latestMessage;
  for (const message of messages) {
    if (message.topic !== filledInPath.topicName) {
      continue;
    }

    const data = getSingleDataItem(simpleGetMessagePathDataItems(message, filledInPath));
    if (data != undefined) {
      latestMatchingQueriedData = data;
      latestMessage = message;
    }
  }

  return { ...state, latestMessage, latestMatchingQueriedData, error: undefined };
}

function handlePathActionStateWithGlobalVars({
  path,
  state,
}: {
  path: string;
  state: GaugeAndIndicatorState;
}): GaugeAndIndicatorState {
  const newPath = parseMessagePath(path);
  // Empty or half-typed paths don't parse; show nothing instead of a TypeError
  if (newPath == undefined) {
    return {
      ...state,
      error: undefined,
      latestMatchingQueriedData: undefined,
      parsedPath: undefined,
      path,
    };
  }
  // Keep the raw path: `$variables` are filled in per evaluation so later variable changes apply.
  return {
    ...state,
    ...evaluateLatestMessage(state, newPath),
    parsedPath: newPath,
    path,
  };
}

/** Re-reads the value from the last received message with the current variables. */
function evaluateLatestMessage(
  state: GaugeAndIndicatorState,
  parsedPath: MessagePath | undefined,
): Pick<GaugeAndIndicatorState, "error" | "latestMatchingQueriedData"> {
  if (!state.latestMessage || !parsedPath) {
    return { error: undefined, latestMatchingQueriedData: undefined };
  }
  try {
    const filledInPath = fillInGlobalVariablesInPath(parsedPath, state.globalVariables ?? {});
    return {
      error: undefined,
      latestMatchingQueriedData: getSingleDataItem(
        simpleGetMessagePathDataItems(state.latestMessage, filledInPath),
      ),
    };
  } catch (err: unknown) {
    return { error: toError(err), latestMatchingQueriedData: undefined };
  }
}

export function initialState({ path }: { path: string }): GaugeAndIndicatorState {
  return {
    globalVariables: undefined,
    path,
    parsedPath: parseMessagePath(path),
    latestMessage: undefined,
    latestMatchingQueriedData: undefined,
    error: undefined,
  };
}

export function stateReducer(
  state: GaugeAndIndicatorState,
  action: GaugeAndIndicatorAction,
): GaugeAndIndicatorState {
  try {
    switch (action.type) {
      case "frame": {
        return handleFrameActionState({ state, messages: action.messages });
      }
      case "path": {
        return handlePathActionStateWithGlobalVars({ state, path: action.path });
      }
      case "seek":
        return {
          ...state,
          latestMessage: undefined,
          latestMatchingQueriedData: undefined,
          error: undefined,
        };
      case "updateGlobalVariables": {
        const next = { ...state, globalVariables: action.globalVariables };
        return { ...next, ...evaluateLatestMessage(next, state.parsedPath) };
      }
    }
  } catch (error) {
    return {
      ...state,
      latestMatchingQueriedData: undefined,
      error: toError(error),
    };
  }
}
