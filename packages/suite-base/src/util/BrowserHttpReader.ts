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

import { promiseTimeout } from "@lichtblick/den/async";
import * as en from "@lichtblick/suite-base/i18n/en";
import type {
  FileReader,
  FileReaderOpenResult,
  FileStream,
} from "@lichtblick/suite-base/util/CachedFilelike.types";
import FetchReader from "@lichtblick/suite-base/util/FetchReader";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

// Bytes fetched from each end of the file when opening it
const EDGE_BYTES = 64 * 1024;

// How long opening waits for the edge data once the head response has arrived. The tail can take an
// extra round trip for its CORS preflight; past this, it is read on demand like any other range.
const EDGE_GRACE_MS = 2000;

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
  /** Cancels the requests that open the file */
  #signal: AbortSignal | undefined;

  public constructor(
    url: string,
    options?: { credentials?: RequestCredentials; signal?: AbortSignal },
  ) {
    this.#url = url;
    this.#credentials = options?.credentials;
    this.#signal = options?.signal;
  }

  #withSignal(signal: AbortSignal): AbortSignal {
    return this.#signal ? AbortSignal.any([signal, this.#signal]) : signal;
  }

  /**
   * Learns the file size in one round trip: the first and last `EDGE_BYTES` are requested in
   * parallel, and their data is returned so the caller can cache it. Header, footer and (usually)
   * the summary/index of MCAP and bag files are in there, so opening needs no further requests.
   */
  public async open(): Promise<FileReaderOpenResult> {
    const head = this.#fetchRange(`bytes=0-${EDGE_BYTES - 1}`);
    // Not a CORS-safelisted range, so cross-origin servers see a preflight first. That runs in
    // parallel with the head request, and if the server refuses it the tail is just not cached.
    const tail = this.#fetchRange(`bytes=-${EDGE_BYTES}`);
    let response: Response;
    try {
      response = await head.response;
    } catch (error) {
      tail.abort();
      throw await this.#openError(error);
    }
    if (response.status !== 206) {
      // Errors, or a server that ignored the range. Don't download the body.
      head.abort();
      tail.abort();
      return this.#checkFullResponse(response);
    }
    const headRange = contentRange(response);
    const identifier = versionOf(response);
    // The edge data only saves later requests, so a failed or stalled read is just left out
    const optional = async (
      edge: typeof head,
      read: () => Promise<Uint8Array | undefined>,
    ): Promise<Uint8Array | undefined> =>
      await promiseTimeout(read(), EDGE_GRACE_MS).catch(() => {
        edge.abort();
        return undefined;
      });
    if (headRange == undefined) {
      // Content-Range is not exposed to this origin (CORS): ask for the size the old way, and keep
      // the head only if it is provably from the same file version
      tail.abort();
      const [headData, full] = await Promise.all([
        optional(head, head.body),
        this.#openWithoutRange(),
      ]);
      const sameVersion = identifier != undefined && full.identifier === identifier;
      return sameVersion
        ? { ...full, initialData: edgeData(headData, undefined, full.size) }
        : full;
    }
    const total = headRange.total;
    const expected = Math.min(EDGE_BYTES, total);
    const readTail = async (): Promise<Uint8Array | undefined> => {
      const tailResponse = await tail.response;
      const range = contentRange(tailResponse);
      // Only the requested range of the same file version can be cached
      if (
        tailResponse.status !== 206 ||
        range?.total !== total ||
        range.start !== total - expected ||
        range.end !== total - 1 ||
        versionOf(tailResponse) !== identifier
      ) {
        tail.abort();
        return undefined;
      }
      return await tail.body();
    };
    const headMatches = headRange.start === 0 && headRange.end === expected - 1;
    if (!headMatches) {
      head.abort();
    }
    const [headData, tailData] = await Promise.all([
      headMatches ? optional(head, head.body) : undefined,
      optional(tail, readTail),
    ]);
    return { size: total, identifier, initialData: edgeData(headData, tailData, total) };
  }

  #fetchRange(range: string): {
    response: Promise<Response>;
    body: () => Promise<Uint8Array>;
    abort: () => void;
  } {
    const controller = new AbortController();
    // "no-store" keeps the browser cache from turning this into a conditional request
    const response = fetch(this.#url, {
      headers: { range },
      cache: "no-store",
      credentials: this.#credentials,
      signal: this.#withSignal(controller.signal),
    });
    response.catch(() => {}); // the caller may not await a request it aborted
    return {
      response,
      body: async () => new Uint8Array(await (await response).arrayBuffer()),
      abort: () => {
        controller.abort();
      },
    };
  }

  /** A GET that is cancelled once the headers arrive, for its Content-Length. */
  async #openWithoutRange(): Promise<FileReaderOpenResult> {
    // A GET is more robust than a HEAD request, since the server might not accept HEAD requests
    // (e.g. when using S3 presigned URLs that only work for one particular method like GET).
    const controller = new AbortController();
    let response: Response;
    try {
      response = await fetch(this.#url, {
        signal: this.#withSignal(controller.signal),
        cache: "no-store",
        credentials: this.#credentials,
      });
    } catch (error) {
      throw await this.#openError(error);
    }
    controller.abort();
    return this.#checkFullResponse(response);
  }

  #checkFullResponse(response: Response): FileReaderOpenResult {
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
      signal: this.#withSignal(
        AbortSignal.any([controller.signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
      ),
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

/** `Content-Range: bytes 0-99/1234`, if the header is readable and the total is known */
function contentRange(
  response: Response,
): { start: number; end: number; total: number } | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  return match
    ? { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) }
    : undefined;
}

/** What identifies the file version: its ETag, or else its modification time */
function versionOf(response: Response): string | undefined {
  return response.headers.get("etag") ?? response.headers.get("last-modified") ?? undefined;
}

/** The fetched ends of the file, skipping any whose length doesn't match the file size */
function edgeData(
  head: Uint8Array | undefined,
  tail: Uint8Array | undefined,
  size: number,
): { offset: number; data: Uint8Array }[] {
  const expected = Math.min(EDGE_BYTES, size);
  const ranges = head?.byteLength === expected ? [{ offset: 0, data: head }] : [];
  if (tail?.byteLength === expected) {
    ranges.push({ offset: size - expected, data: tail });
  }
  return ranges;
}
