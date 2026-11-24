// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import manifest from "../../../../chrome-extension/manifest.json";

/** Origins the proxy extension's content script runs on. */
export const PROXY_ORIGINS: ReadonlySet<string> = new Set(
  manifest.content_scripts.flatMap(({ matches }) => matches.map((match) => new URL(match).origin)),
);

/** Hosts browsers let an https page reach over plain ws:// and http:// */
export function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}
