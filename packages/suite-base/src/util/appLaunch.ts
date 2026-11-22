// SPDX-License-Identifier: MPL-2.0

import { create } from "zustand";

import { AppURLState, updateAppURLState } from "./appURLState";
import { takeSourcePick } from "./sourcePick";

/**
 * Launch app URL state (`ds`, `layoutUrl`, ...) from inside the app. Workspace applies it exactly
 * like a link that opened the app, including downloading and installing the layout.
 */
export const useAppLaunch = create<{ url?: URL; launch: (state: AppURLState) => void }>((set) => ({
  launch: (state) => {
    // Picked for something else (e.g. a comparison row): hand the source over, and neither open it
    // nor apply its layout
    if (
      state.ds != undefined &&
      takeSourcePick(state.ds, {
        type: "connection",
        params: state.dsParams,
        urls: state.dsParamsArray?.urls,
      })
    ) {
      return;
    }
    // From the bare page URL, so no time or source params of what is open now carry over.
    const page = new URL(window.location.pathname, window.location.origin);
    set({ url: updateAppURLState(page, state) });
  },
}));
