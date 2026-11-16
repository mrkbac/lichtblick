// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Shared by the build (rspackConfigs.ts) and the app (index.tsx), so both sides agree.

/** Service worker cache for the content-hashed build files */
export const RUNTIME_CACHE_NAME = "lichtblick-assets";

/** A content-hashed build file path. Its content never changes, so a cached copy is final. */
export const HASHED_FILE = /\/[\w.-]*[0-9a-f]{16}\.\w+$/;

/** Every hashed file of a build, written next to index.html */
export const ASSET_LIST_FILE = "asset-list.json";

export type AssetList = {
  /** LICHTBLICK_SUITE_VERSION of the build */
  version: string;
  files: string[];
};
