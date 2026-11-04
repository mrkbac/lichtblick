// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import {
  ICurrentLayout,
  LayoutState,
  UpdatePanelState,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";

type UseUpdateSharedPanelStateReturn = {
  updateSharedPanelState: UpdatePanelState;
};

const useUpdateSharedPanelState = (
  getLayoutState: () => LayoutState,
  setLayoutState: (state: LayoutState) => void,
): UseUpdateSharedPanelStateReturn => {
  const updateSharedPanelState = useCallback<ICurrentLayout["actions"]["updateSharedPanelState"]>(
    (type, newSharedState) => {
      if (getLayoutState().selectedLayout?.data == undefined) {
        return;
      }

      setLayoutState({
        ...getLayoutState(),
        sharedPanelState: { ...getLayoutState().sharedPanelState, [type]: newSharedState },
      });
    },
    [setLayoutState, getLayoutState],
  );
  return { updateSharedPanelState };
};

export default useUpdateSharedPanelState;
