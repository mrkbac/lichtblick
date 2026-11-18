// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MouseEvent, Dispatch } from "react";

import { useLayoutBrowserReducer } from "@lichtblick/suite-base/components/LayoutBrowser/reducer";
import {
  LayoutSelectionState,
  LayoutSelectionAction,
} from "@lichtblick/suite-base/components/LayoutBrowser/types";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import useCallbackWithToast from "@lichtblick/suite-base/hooks/useCallbackWithToast";
import { AppEvent } from "@lichtblick/suite-base/services/IAnalytics";
import { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";

export type UseLayoutNavigation = {
  onSelectLayout: (
    item: Layout,
    params?: { selectedViaClick?: boolean; event?: MouseEvent },
  ) => Promise<void>;
  state: LayoutSelectionState;
  dispatch: Dispatch<LayoutSelectionAction>;
};

const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

export function useLayoutNavigation(menuClose?: () => void): UseLayoutNavigation {
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const layoutManager = useLayoutManager();
  const analytics = useAnalytics();
  const { setSelectedLayoutId } = useCurrentLayoutActions();

  const [state, dispatch] = useLayoutBrowserReducer({
    lastSelectedId: currentLayoutId,
    busy: layoutManager.isBusy(),
    error: layoutManager.error,
    online: layoutManager.isOnline,
  });

  const onSelectLayout = useCallbackWithToast(
    async (
      item: Layout,
      { selectedViaClick = false, event }: { selectedViaClick?: boolean; event?: MouseEvent } = {},
    ) => {
      if (selectedViaClick) {
        analytics.logEvent(AppEvent.LAYOUT_SELECT, { permission: item.permission });
      }
      if (event?.ctrlKey === true || event?.metaKey === true || event?.shiftKey === true) {
        if (item.id !== currentLayoutId) {
          // selectedIds is empty on intial render
          // this adds the current layout to selection
          if (state.selectedIds.length === 0 && currentLayoutId != undefined) {
            dispatch({ type: "select-id", id: currentLayoutId });
          }
          dispatch({
            type: "select-id",
            id: item.id,
            modKey: event.ctrlKey || event.metaKey,
            shiftKey: event.shiftKey,
          });
        }
      } else {
        // Re-selecting the shown layout would reload every panel for nothing.
        if (item.id !== currentLayoutId) {
          setSelectedLayoutId(item.id);
        }
        dispatch({ type: "select-id", id: item.id });
        menuClose?.();
      }
    },
    [
      analytics,
      currentLayoutId,
      dispatch,
      menuClose,
      setSelectedLayoutId,
      state.selectedIds.length,
    ],
  );

  return { onSelectLayout, state, dispatch };
}
