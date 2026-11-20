// SPDX-License-Identifier: MPL-2.0

import { create } from "zustand";

import { AppURLState, updateAppURLState } from "./appURLState";

/**
 * Launch app URL state (`ds`, `layoutUrl`, ...) from inside the app. Workspace applies it exactly
 * like a link that opened the app, including downloading and installing the layout.
 */
export const useAppLaunch = create<{ url?: URL; launch: (state: AppURLState) => void }>((set) => ({
  launch: (state) => {
    // From the bare page URL, so no time or source params of what is open now carry over.
    const page = new URL(window.location.pathname, window.location.origin);
    set({ url: updateAppURLState(page, state) });
  },
}));
