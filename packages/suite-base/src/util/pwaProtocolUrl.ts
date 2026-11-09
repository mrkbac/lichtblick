// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** Translate a manifest protocol callback into an app URL without navigating away. */
export function pwaProtocolUrl(targetURL: string, appURL: URL): URL | undefined {
  try {
    const target = new URL(targetURL);
    if (
      target.origin !== appURL.origin ||
      target.pathname !== appURL.pathname ||
      target.username !== "" ||
      target.password !== "" ||
      target.searchParams.getAll("protocol").length !== 1
    ) {
      return undefined;
    }
    const protocol = new URL(target.searchParams.get("protocol")!);
    if (
      protocol.protocol !== "web+lichtblick:" ||
      protocol.host !== "open" ||
      (protocol.pathname !== "" && protocol.pathname !== "/") ||
      protocol.username !== "" ||
      protocol.password !== "" ||
      protocol.hash !== ""
    ) {
      return undefined;
    }
    for (const [key, value] of protocol.searchParams) {
      if (
        !["ds", "layoutUrl", "time", "mcap-bundle"].includes(key) &&
        !/^ds\.(?!__proto__$|constructor$|prototype$)[\w]+$/.test(key)
      ) {
        return undefined;
      }
      if (key === "layoutUrl" || key === "ds.url") {
        for (const address of key === "ds.url" ? value.split(",") : [value]) {
          const url = new URL(address);
          const schemes =
            key === "layoutUrl" ? ["http:", "https:"] : ["http:", "https:", "ws:", "wss:"];
          if (!schemes.includes(url.protocol) || url.username !== "" || url.password !== "") {
            return undefined;
          }
        }
      }
    }
    const result = new URL(appURL.href);
    result.search = protocol.search;
    result.hash = "";
    return result;
  } catch {
    return undefined;
  }
}
