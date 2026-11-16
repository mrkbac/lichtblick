// SPDX-License-Identifier: MPL-2.0

import { AttributionControl } from "maplibre-gl";

import { ATTRIBUTION_AUTO_HIDE_MS } from "./layers";

/**
 * Compact attribution that collapses to its (i) button 5 seconds after it is first shown,
 * instead of staying expanded until the user drags the map.
 */
export class AutoHideAttributionControl extends AttributionControl {
  #timer: ReturnType<typeof setTimeout> | undefined;

  public constructor() {
    super({ compact: true });
    // maplibre expands the control once the first attributed source loads, possibly long after
    // onAdd, so start the timer from there.
    const updateCompact = this._updateCompact;
    this._updateCompact = () => {
      updateCompact();
      if (
        this.#timer == undefined &&
        this._container.classList.contains("maplibregl-compact-show")
      ) {
        this.#timer = setTimeout(this._updateCompactMinimize, ATTRIBUTION_AUTO_HIDE_MS);
      }
    };
  }

  public override onRemove(): void {
    clearTimeout(this.#timer);
    super.onRemove();
  }
}
