// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import i18next from "i18next";

import * as en from "@lichtblick/suite-base/i18n/en";
import type { FileReader, FileStream } from "@lichtblick/suite-base/util/CachedFilelike.types";
import FetchReader from "@lichtblick/suite-base/util/FetchReader";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

// Bounds the CORS diagnosis request so a hanging server can't delay the error
const PROBE_TIMEOUT_MS = 5000;

// This reader runs in the data source workers, where the app never initialized i18next
async function ensureI18n(): Promise<void> {
  if (!i18next.isInitialized) {
    await i18next.init({ resources: { en }, lng: navigator.language, fallbackLng: "en" });
  }
}

// A file reader that reads from a remote HTTP URL, for usage in the browser (not for node.js).
export default class BrowserHttpReader implements FileReader {
  #url: string;
  #credentials: RequestCredentials | undefined;

  public constructor(url: string, options?: { credentials?: RequestCredentials }) {
    this.#url = url;
    this.#credentials = options?.credentials;
  }

  public async open(): Promise<{ size: number; identifier?: string }> {
    let response: Response;
    try {
      // Make a GET request and then immediately cancel it. This is more robust than a HEAD request,
      // since the server might not accept HEAD requests (e.g. when using S3 presigned URLs that
      // only work for one particular method like GET).
      // Note that we cannot use `range: "bytes=0-1"` or so, because then we can't get the actual
      // file size without making Content-Range a CORS header, therefore making all this a bit less
      // robust.
      // "no-store" forces an unconditional remote request. When the browser's cache is populated,
      // it may add a `range` header to the request, which causes some servers to omit the
      // `accept-ranges` header in the response.
      const controller = new AbortController();
      response = await fetch(this.#url, {
        signal: controller.signal,
        cache: "no-store",
        credentials: this.#credentials,
      });
      controller.abort();
    } catch (error) {
      throw await this.#openError(error);
    }
    if (!response.ok) {
      throw new Error(
        `Fetching remote file failed. <${this.#url}> Status code: ${response.status}.`,
      );
    }
    if (response.headers.get("accept-ranges") !== "bytes") {
      let errMsg =
        "Support for HTTP Range requests was not detected on the remote file.\n\nConfirm the resource has an 'Accept-Ranges: bytes' header.";

      if (!isDesktopApp()) {
        errMsg +=
          "\n\nSometimes this is due to a CORS configuration error on the server. Make sure CORS is enabled with Access-Control-Allow-Origin, and that Access-Control-Expose-Headers includes Accept-Ranges.";
      }

      throw new Error(errMsg);
    }
    const size = response.headers.get("content-length");
    if (size == undefined) {
      throw new Error(`Remote file is missing file size. <${this.#url}>`);
    }
    return {
      size: parseInt(size),
      identifier:
        response.headers.get("etag") ?? response.headers.get("last-modified") ?? undefined,
    };
  }

  /**
   * fetch() rejects with the same opaque TypeError for a CORS rejection and a network failure.
   * Tell them apart with a no-cors request: it skips the CORS check, so it reaching the server
   * means CORS blocked the read. Its failure is inconclusive: the server may be down, or refuse
   * no-cors reads (Cross-Origin-Resource-Policy).
   */
  async #openError(error: unknown): Promise<Error> {
    if (isDesktopApp() || !(error instanceof TypeError)) {
      return new Error(`Fetching remote file failed. ${error}`);
    }
    const controller = new AbortController();
    const reachable = await fetch(this.#url, {
      mode: "no-cors",
      cache: "no-store",
      credentials: this.#credentials,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
    }).then(
      () => true,
      () => false,
    );
    controller.abort();
    await ensureI18n();
    const options = {
      origin: new URL(this.#url, globalThis.location.href).origin,
      appOrigin: globalThis.location.origin,
      error: error.message,
    };
    if (!reachable) {
      return new Error(i18next.t("httpErrors:remoteFileUnreachable", options));
    }
    return new Error(
      i18next.t(
        this.#credentials === "include"
          ? "httpErrors:remoteFileCorsCredentials"
          : "httpErrors:remoteFileCors",
        options,
      ),
    );
  }

  public fetch(offset: number, length: number): FileStream {
    const headers = new Headers({ range: `bytes=${offset}-${offset + (length - 1)}` });
    const reader = new FetchReader(this.#url, { headers, credentials: this.#credentials });
    reader.read();
    return reader;
  }
}
