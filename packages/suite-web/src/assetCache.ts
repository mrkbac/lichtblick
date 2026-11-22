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

/**
 * Marks this page's own prefetches of build files: a file missing then isn't something the page
 * needs, so the service worker doesn't report it (see fetchDidSucceed in rspackConfigs.ts, which
 * repeats the literal).
 */
export const PREFETCH_HEADER = "x-lichtblick-prefetch";
