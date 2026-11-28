// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutState } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { LayoutFavorites, layoutIsFavorite } from "@lichtblick/suite-base/services/ILayoutManager";
import { Layout, layoutIsShared } from "@lichtblick/suite-base/services/ILayoutStorage";
import { getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";

function firstByName(layouts: readonly Layout[]): Layout | undefined {
  return [...layouts].sort((a, b) => a.name.localeCompare(b.name))[0];
}

/**
 * Returns the favorite layout to select when the app opens.
 *
 * Favorite shared layouts take precedence over favorite personal layouts. When several favorites
 * qualify, the first one in the layout browser's order (alphabetical by name) is returned.
 */
export function findFavoriteLayout(
  layouts: readonly Layout[],
  favorites: LayoutFavorites,
): Layout | undefined {
  const favoriteLayouts = layouts.filter((layout) => layoutIsFavorite(favorites, layout));
  return (
    firstByName(favoriteLayouts.filter(layoutIsShared)) ??
    firstByName(favoriteLayouts.filter((layout) => !layoutIsShared(layout)))
  );
}

/**
 * Drops shared panel state of panel types no longer in the layout. Returns the same object when
 * nothing is dropped: panels select it by reference, so a new object re-renders every panel.
 */
export function pruneSharedPanelState(
  state: LayoutState["sharedPanelState"],
  configById: Readonly<Record<string, unknown>>,
): LayoutState["sharedPanelState"] {
  if (state == undefined) {
    return state;
  }
  const inUse = new Set(Object.keys(configById).map(getPanelTypeFromId));
  const keys = Object.keys(state);
  if (keys.every((type) => inUse.has(type))) {
    return state;
  }
  return Object.fromEntries(
    keys.filter((type) => inUse.has(type)).map((type) => [type, state[type]]),
  );
}
