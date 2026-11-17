// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Streamed with HTTP range requests; the host must allow CORS GET/HEAD with a Range header.
// Rebuild the file with `uv run ci/create-boreas-showcase.py`.
export const SAMPLE_BOREAS_DATA_SOURCE_URL =
  "https://pub-28ff7cafca60457aa0fb10e79c70ff4b.r2.dev/boreas-showcase-v2.mcap";
export const SAMPLE_BOREAS_DATA_SOURCE_ID = "sample-boreas";
export const SAMPLE_BOREAS_DATA_SOURCE_TYPE = "sample";
export const SAMPLE_BOREAS_DATA_SOURCE_DISPLAY_NAME = "Sample: Boreas";
export const SAMPLE_BOREAS_DATA_SOURCE_ICON_NAME = "FileASPX";
export const SAMPLE_BOREAS_DATA_SOURCE_NAME =
  "Adapted from the Boreas dataset, Keenan Burnett et al., University of Toronto. CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ · https://www.boreas.utias.utoronto.ca/";
export const SAMPLE_BOREAS_DATA_SOURCE_READ_AHEAD_DURATION = { sec: 10, nsec: 0 };
