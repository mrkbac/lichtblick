// SPDX-License-Identifier: MPL-2.0

// Globals the webpack build injects with DefinePlugin
Object.assign(globalThis, {
  LICHTBLICK_SUITE_VERSION: "TEST",
  LICHTBLICK_PRODUCT_NAME: "Lichtblick",
  LICHTBLICK_REPOSITORY_URL: "https://github.com/mrkbac/lichtblick",
  API_URL: "/",
  OTLP_ENDPOINT: undefined,
});
