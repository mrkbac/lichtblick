// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, add, subtract } from "@foxglove/rostime";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StoreApi } from "zustand";

import { useGuaranteedContext } from "@lichtblick/hooks";
import { Immutable } from "@lichtblick/suite";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import { APP_SHORTCUTS } from "@lichtblick/suite-base/components/KeyboardShortcuts/appShortcuts";
import {
  ContextInternal,
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { MessagePipelineInternalState } from "@lichtblick/suite-base/components/MessagePipeline/store";
import { CompareSide } from "@lichtblick/suite-base/players/types";
import { shortcutKeyHandlers } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { OffsetRequest, nextOffsets, pendingRequests } from "./offsetRequests";
import { SideView } from "./sideView";

/** Colors of sides A, B, C, …, picked to stay apart from each other in light and dark themes */
const SIDE_COLORS = ["#4e98e2", "#f5a524", "#3ecf8e", "#c678dd", "#ef5b5b", "#2ec4c6"];

export type CompareSideInfo = Immutable<CompareSide> & {
  index: number;
  /** "A", "B", … */
  label: string;
  color: string;
  view: SideView;
};

export type CompareState = {
  sides: readonly CompareSideInfo[];
  /** Prefix of the side that panels following the global choice show */
  activeSide: string;
  setActiveSide: (prefix: string) => void;
  /** The pipeline store showing every side, which side scopes are made from */
  rootStore: StoreApi<MessagePipelineInternalState>;
  /**
   * Move `side` to `change` seconds (or by a function of its latest requested offset). Requests
   * are numbered and kept per player, so editors anywhere build on each other's pending changes.
   */
  requestOffset: (side: number, change: number | ((current: number) => number)) => void;
};

const CompareContext = createContext<CompareState | undefined>(undefined);

function sideLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `R${index + 1}`;
}

const selectCompareSides = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.compareSides;
const selectAppliedRequest = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.compareRequest;
const selectSetOffsets = (ctx: MessagePipelineContext) => ctx.setCompareOffsets;

/** Provides the compared sides, when recordings are compared, to everything below it */
export function CompareProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const rootStore = useGuaranteedContext(ContextInternal);
  const compareSides = useMessagePipeline(selectCompareSides);
  const prefixes = compareSides?.map((side) => side.prefix).join("\0") ?? "";

  // One view per side for as long as the same sides are compared, so caches survive offset changes
  const views = useMemo(() => {
    const all = prefixes === "" ? [] : prefixes.split("\0");
    return new Map(all.map((prefix) => [prefix, new SideView(prefix, all)]));
  }, [prefixes]);

  const [chosenSide, setActiveSide] = useState<string | undefined>(undefined);

  // Offset requests the player hasn't applied yet, shared by every editor of this player
  const appliedRequest = useMessagePipeline(selectAppliedRequest);
  const setCompareOffsets = useMessagePipeline(selectSetOffsets);
  const latest = useRef({ compareSides, appliedRequest });
  latest.current = { compareSides, appliedRequest };
  const requests = useRef<{ inFlight: OffsetRequest[]; last: number }>({ inFlight: [], last: 0 });
  const requestOffset = useCallback(
    (side: number, change: number | ((current: number) => number)) => {
      const { compareSides: published, appliedRequest: applied } = latest.current;
      if (!published || !setCompareOffsets) {
        return;
      }
      const pending = requests.current;
      const inFlight = pendingRequests(pending.inFlight, applied);
      const offsets = nextOffsets(
        published.map((item) => item.offsetSec),
        inFlight,
        side,
        change,
      );
      const request = Math.max(pending.last, applied ?? 0) + 1;
      requests.current = { inFlight: [...inFlight, { request, offsets }], last: request };
      setCompareOffsets(offsets, request);
    },
    [setCompareOffsets],
  );
  // A new player starts with nothing pending
  useEffect(() => {
    requests.current = { inFlight: [], last: 0 };
  }, [setCompareOffsets]);

  const value = useMemo((): CompareState | undefined => {
    if (!compareSides || compareSides.length < 2) {
      return undefined;
    }
    const sides = compareSides.map(
      (side, index): CompareSideInfo => ({
        ...side,
        index,
        label: sideLabel(index),
        color: SIDE_COLORS[index % SIDE_COLORS.length]!,
        view: views.get(side.prefix)!,
      }),
    );
    const activeSide = sides.some((side) => side.prefix === chosenSide)
      ? chosenSide!
      : sides[0]!.prefix;
    return { sides, activeSide, setActiveSide, rootStore, requestOffset };
  }, [chosenSide, compareSides, requestOffset, rootStore, views]);

  const keyDownHandlers = useMemo(
    () =>
      shortcutKeyHandlers(APP_SHORTCUTS, {
        "app.nextCompareSide": () => {
          if (!value) {
            return false;
          }
          const index = value.sides.findIndex((side) => side.prefix === value.activeSide);
          setActiveSide(value.sides[(index + 1) % value.sides.length]!.prefix);
          return true;
        },
      }),
    [value],
  );

  return (
    <CompareContext.Provider value={value}>
      {value && <KeyListener global keyDownHandlers={keyDownHandlers} />}
      {children}
    </CompareContext.Provider>
  );
}

/** The compared sides, or undefined when recordings are not compared */
export function useCompare(): CompareState | undefined {
  return useContext(CompareContext);
}

/**
 * A store showing `view`'s side of `base`: the same store API, so every hook reading the message
 * pipeline (and so every panel) works unchanged on one side.
 */
export function createSideStore(
  base: StoreApi<MessagePipelineInternalState>,
  view: SideView,
): StoreApi<MessagePipelineInternalState> {
  let lastBase: MessagePipelineInternalState | undefined;
  let lastScoped: MessagePipelineInternalState | undefined;
  const getState = (): MessagePipelineInternalState => {
    const state = base.getState();
    if (state !== lastBase || !lastScoped) {
      lastBase = state;
      lastScoped = { ...state, public: view.mapPublic(state.public) };
    }
    return lastScoped;
  };
  return {
    getState,
    getInitialState: getState,
    setState: base.setState,
    subscribe: (listener) => {
      let previous = getState();
      return base.subscribe(() => {
        const next = getState();
        const prev = previous;
        previous = next;
        listener(next, prev);
      });
    },
  };
}

/** Shows one side of a comparison to everything below it */
export function SideScope({
  side,
  children,
}: {
  side: CompareSideInfo;
  children: React.ReactNode;
}): React.JSX.Element {
  const compare = useCompare();
  const base = useGuaranteedContext(ContextInternal);
  // Made from the store showing every side, so scopes don't nest
  const root = compare?.rootStore ?? base;
  const store = useMemo(() => createSideStore(root, side.view), [root, side.view]);
  return <ContextInternal.Provider value={store}>{children}</ContextInternal.Provider>;
}

/** The time in `side`'s own recording at `stamp` on the shared timeline */
export function sideLocalTime(side: Immutable<CompareSide>, stamp: Time): Time {
  return add(side.start, subtract(stamp, side.sharedStart));
}

/** When `side` ends on the shared timeline */
export function sideSharedEnd(side: Immutable<CompareSide>): Time {
  return add(side.sharedStart, subtract(side.end, side.start));
}
