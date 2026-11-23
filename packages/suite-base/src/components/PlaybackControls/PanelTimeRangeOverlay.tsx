// SPDX-License-Identifier: MPL-2.0

import { useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import { getVisiblePanelIds } from "@lichtblick/suite-base/util/tabLayout";

const useStyles = makeStyles()((theme) => ({
  range: {
    position: "absolute",
    top: "calc(50% + 5px)",
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.palette.text.secondary,
    pointerEvents: "none",
  },
}));

const selectFocusedPanelId = (store: TimelineInteractionStateStore) => store.focusedPanelId;
const selectFocusedRange = (store: TimelineInteractionStateStore) =>
  store.focusedPanelId == undefined ? undefined : store.panelTimeRanges.get(store.focusedPanelId);
const selectLayoutData = (state: LayoutState) => state.selectedLayout?.data;

export function PanelTimeRangeOverlay({
  duration,
}: {
  duration: number;
}): React.JSX.Element | null {
  const { classes } = useStyles();
  const focusedPanelId = useTimelineInteractionState(selectFocusedPanelId);
  const range = useTimelineInteractionState(selectFocusedRange);
  const layoutData = useCurrentLayoutSelector(selectLayoutData);

  const visible = useMemo(
    () =>
      !layoutData?.layout ||
      (focusedPanelId != undefined && getVisiblePanelIds(layoutData).includes(focusedPanelId)),
    [layoutData, focusedPanelId],
  );
  if (
    !range ||
    !visible ||
    duration <= 0 ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max)
  ) {
    return null;
  }

  const left = Math.max(0, range.min);
  const right = Math.min(duration, range.max);
  if (left >= right) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={classes.range}
      data-testid="focused-panel-time-range"
      style={{
        left: `${(left / duration) * 100}%`,
        width: `${((right - left) / duration) * 100}%`,
      }}
    />
  );
}
