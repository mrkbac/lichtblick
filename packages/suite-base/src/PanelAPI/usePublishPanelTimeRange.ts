// SPDX-License-Identifier: MPL-2.0

import { useCallback, useContext, useEffect } from "react";

import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import {
  PanelTimeRange,
  TimelineInteractionStateContext,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";

/**
 * Publish the visible range in playback seconds for the scrubber to display when this panel
 * is focused. Pass undefined when the panel has no playback-time view.
 */
export function usePublishPanelTimeRange(): (range: PanelTimeRange | undefined) => void {
  const panelId = useContext(PanelContext)?.id;
  const timeline = useContext(TimelineInteractionStateContext);
  const publish = useCallback(
    (range: PanelTimeRange | undefined) => {
      if (panelId != undefined) {
        timeline?.getState().setPanelTimeRange(panelId, range);
      }
    },
    [panelId, timeline],
  );

  useEffect(
    () => () => {
      publish(undefined);
    },
    [publish],
  );

  return publish;
}
