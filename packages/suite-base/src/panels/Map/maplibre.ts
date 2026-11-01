// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { addProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";

// Import MapLibre through this module so its global setup runs once for every panel using it.

// MapLibre locates its worker relative to its own module URL, which a bundle doesn't preserve.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
// pmtiles://https://host/archive.pmtiles works as a raster, elevation, or style source URL.
addProtocol("pmtiles", new Protocol().tile);

export { Map } from "maplibre-gl";
