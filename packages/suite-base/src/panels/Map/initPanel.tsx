// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { addProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";

import { useCrash } from "@lichtblick/hooks";
import { PanelExtensionContext } from "@lichtblick/suite";
import { CaptureErrorBoundary } from "@lichtblick/suite-base/components/CaptureErrorBoundary";
import { createSyncRoot } from "@lichtblick/suite-base/panels/createSyncRoot";

import MapPanel from "./MapPanel";

import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre locates its worker relative to its own module URL, which a bundle doesn't preserve.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
// pmtiles://https://host/archive.pmtiles works as a raster, elevation, or style source URL.
addProtocol("pmtiles", new Protocol().tile);

export function initPanel(
  crash: ReturnType<typeof useCrash>,
  context: PanelExtensionContext,
): () => void {
  return createSyncRoot(
    <CaptureErrorBoundary onError={crash}>
      <MapPanel context={context} />
    </CaptureErrorBoundary>,
    context.panelElement,
  );
}
