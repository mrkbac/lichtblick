// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Application configuration constants.
 * Centralizes all environment variables and build-time constants.
 */

// Global variables defined by webpack DefinePlugin
declare const API_URL: string | undefined;
declare const LICHTBLICK_SUITE_VERSION: string | undefined;
declare const LICHTBLICK_PRODUCT_NAME: string | undefined;
declare const LICHTBLICK_REPOSITORY_URL: string | undefined;
declare const DEV_WORKSPACE: string | undefined;

export const APP_CONFIG = {
  /**
   * API base URL for HTTP requests
   */
  apiUrl: API_URL,

  /**
   * Application version
   */
  version: LICHTBLICK_SUITE_VERSION ?? "unknown",

  /**
   * App name shown in the UI (root package.json `productName`)
   */
  productName: LICHTBLICK_PRODUCT_NAME ?? "Digitalis",

  /**
   * Source repository web URL (root package.json `repository.url`), for source, license and releases
   */
  repositoryUrl: LICHTBLICK_REPOSITORY_URL ?? "https://github.com/mrkbac/lichtblick",

  /**
   * Development workspace prefix (for local storage keys)
   */
  devWorkspace: DEV_WORKSPACE ?? "",
} as const;
