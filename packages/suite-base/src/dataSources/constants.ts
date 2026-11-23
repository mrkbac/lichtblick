// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// "Explore sample data" lists this catalog (see components/Catalog/catalogUrl.ts); editing it on
// R2 adds, changes or removes samples without a release.
export const SAMPLES_CATALOG_URL =
  "https://pub-28ff7cafca60457aa0fb10e79c70ff4b.r2.dev/catalog.json";

/** Form validator for the ws:// / wss:// URL field of WebSocket data sources. */
export function validateWebSocketUrl(newValue: string): Error | undefined {
  try {
    const url = new URL(newValue);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return new Error(`Invalid protocol: ${url.protocol}`);
    }
    return undefined;
  } catch (err: unknown) {
    console.error(err);
    return new Error("Enter a valid url");
  }
}
