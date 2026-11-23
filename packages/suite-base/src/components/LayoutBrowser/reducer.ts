// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { Dispatch, useReducer } from "react";

import {
  LayoutSelectionState,
  LayoutSelectionAction,
} from "@lichtblick/suite-base/components/LayoutBrowser/types";

function reducer(draft: LayoutSelectionState, action: LayoutSelectionAction) {
  switch (action.type) {
    case "clear-multi-action":
      draft.multiAction = undefined;
      break;

    case "queue-multi-action":
      draft.multiAction = { action: action.action, ids: draft.selectedIds };
      break;

    case "shift-multi-action":
      if (draft.multiAction) {
        const [done, ...rest] = draft.multiAction.ids;
        if (draft.multiAction.action === "delete") {
          // A deleted layout can't stay selected: menus would act on it and a re-delete throws.
          draft.selectedIds = draft.selectedIds.filter((id) => id !== done);
        }
        draft.multiAction.ids = rest;
        if (draft.multiAction.ids.length === 0) {
          draft.multiAction = undefined;
        }
      }
      break;

    case "select-id": {
      const { id, modKey, shiftKey } = action;

      if (modKey === true) {
        // Toggle selection (Ctrl / Cmd)
        draft.selectedIds = _.xor(draft.selectedIds, id ? [id] : []);
      } else if (shiftKey === true) {
        // explicitly disable multi selection with shift key
        draft.multiAction = undefined;
      } else {
        // Normal click → single select
        draft.multiAction = undefined;
        draft.selectedIds = id ? [id] : [];
      }

      draft.lastSelectedId = id;
      break;
    }

    case "set-busy":
      draft.busy = action.value;
      break;

    case "set-error":
      draft.error = action.value;
      break;

    case "set-online":
      draft.online = action.value;
      break;
  }
}

const immerReducer = produce(reducer);

export function useLayoutBrowserReducer(
  props: Pick<LayoutSelectionState, "busy" | "error" | "online" | "lastSelectedId">,
): [LayoutSelectionState, Dispatch<LayoutSelectionAction>] {
  return useReducer(immerReducer, {
    ...props,
    selectedIds: [],
    multiAction: undefined,
  });
}
