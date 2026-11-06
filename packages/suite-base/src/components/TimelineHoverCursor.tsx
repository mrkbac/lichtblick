// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { makeStyles } from "tss-react/mui";

import { useGuaranteedContext } from "@lichtblick/hooks";
import { Immutable } from "@lichtblick/suite";
import {
  TimelineInteractionStateContext,
  TimelineInteractionStateStore,
  useClearHoverValue,
  useSetHoverValue,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import type { HoverValue } from "@lichtblick/suite-base/types/hoverValue";

const useStyles = makeStyles()((theme) => ({
  // Same look as the hover bar of TimeBasedChart and Plot
  cursor: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -1,
    display: "none",
    backgroundColor: theme.palette.warning.main,
    pointerEvents: "none",
  },
}));

/**
 * Horizontal position (0..1) of the shared hovered playback time on a timeline spanning the whole
 * data source, or undefined when nothing time-based is hovered or it falls outside.
 */
export function playbackHoverFraction(
  hoverValue: Immutable<HoverValue> | undefined,
  durationSec: number,
): number | undefined {
  if (hoverValue?.type !== "PLAYBACK_SECONDS" || !(durationSec > 0)) {
    return undefined;
  }
  const fraction = hoverValue.value / durationSec;
  return fraction >= 0 && fraction <= 1 ? fraction : undefined;
}

/**
 * Thin line at the shared hovered playback time, for a timeline from the data source start over
 * `durationSec`. Place it in a `position: relative` container. It moves itself through a store
 * subscription, so hovering never re-renders the host.
 */
export function TimelineHoverCursor({ durationSec }: { durationSec: number }): React.JSX.Element {
  const { classes } = useStyles();
  const store = useGuaranteedContext(TimelineInteractionStateContext);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const update = ({ hoverValue }: TimelineInteractionStateStore) => {
      const el = ref.current;
      if (!el) {
        return;
      }
      const fraction = playbackHoverFraction(hoverValue, durationSec);
      el.style.display = fraction == undefined ? "none" : "block";
      if (fraction != undefined) {
        el.style.left = `${fraction * 100}%`;
      }
    };
    update(store.getState());
    return store.subscribe(update);
  }, [store, durationSec]);

  return <div ref={ref} className={classes.cursor} data-testid="timeline-hover-cursor" />;
}

/**
 * Publishes the hovered time (seconds since the data source start) to the shared hover state that
 * Plot, State Transitions, the playback bar and the other timelines show; undefined clears it.
 */
export function usePublishPlaybackHover(): (secondsSinceStart: number | undefined) => void {
  const componentId = useId();
  const setHoverValue = useSetHoverValue();
  const clearHoverValue = useClearHoverValue();

  useEffect(
    () => () => {
      clearHoverValue(componentId);
    },
    [clearHoverValue, componentId],
  );

  return useCallback(
    (secondsSinceStart: number | undefined) => {
      if (secondsSinceStart == undefined) {
        clearHoverValue(componentId);
      } else {
        setHoverValue({ componentId, type: "PLAYBACK_SECONDS", value: secondsSinceStart });
      }
    },
    [clearHoverValue, componentId, setHoverValue],
  );
}
