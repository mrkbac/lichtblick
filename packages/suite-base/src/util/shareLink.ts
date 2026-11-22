// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  AppURLState,
  readableHref,
  updateAppURLState,
} from "@lichtblick/suite-base/util/appURLState";

/** Fragment key of a layout embedded in a share link: `#layout=<deflate-raw, base64url>` */
const LAYOUT_HASH_PREFIX = "layout=";

/**
 * Longest encoded layout a share link carries. The fragment never reaches a server, but chat apps
 * and issue trackers mangle very long links; bigger layouts are left out (the caller says so).
 */
export const MAX_SHARED_LAYOUT_LENGTH = 16_000;

function pipe(bytes: string | Uint8Array<ArrayBuffer>, stream: GenericTransformStream): Response {
  return new Response(new Response(bytes).body!.pipeThrough(stream));
}

/** Compresses layout data into a URL-safe string. */
export async function encodeSharedLayout(data: unknown): Promise<string> {
  const compressed = await pipe(
    JSON.stringify(data) ?? "null",
    new CompressionStream("deflate-raw"),
  ).arrayBuffer();
  return new Uint8Array(compressed).toBase64({ alphabet: "base64url", omitPadding: true });
}

/** Reverses encodeSharedLayout, returning the layout's JSON text. */
export async function decodeSharedLayout(encoded: string): Promise<string> {
  const bytes = Uint8Array.fromBase64(encoded, { alphabet: "base64url" });
  return await pipe(bytes, new DecompressionStream("deflate-raw")).text();
}

/** The encoded layout in a share link's fragment, if it has one of acceptable size. */
export function sharedLayoutFromHash(hash: string): string | undefined {
  const value = hash.replace(/^#/, "");
  if (!value.startsWith(LAYOUT_HASH_PREFIX)) {
    return undefined;
  }
  const encoded = value.slice(LAYOUT_HASH_PREFIX.length);
  return encoded !== "" && encoded.length <= MAX_SHARED_LAYOUT_LENGTH ? encoded : undefined;
}

/** Page params that aren't source state but change how the app loads, so a link keeps them. */
const KEPT_PAGE_PARAMS = ["workspace"];

/**
 * A link on `href`'s page that reopens `state` (the active source and time), with the encoded
 * layout in the fragment when given and small enough. The address bar's other query params are
 * dropped: they can lag the active source (e.g. a launch's `mcap-bundle`).
 */
export function buildShareLink(
  href: string,
  state: AppURLState,
  encodedLayout: string | undefined,
): { link: string; layoutIncluded: boolean } {
  const page = new URL(href);
  const base = new URL(page.pathname, page.origin);
  for (const key of KEPT_PAGE_PARAMS) {
    for (const value of page.searchParams.getAll(key)) {
      base.searchParams.append(key, value);
    }
  }
  const url = updateAppURLState(base, state);
  const layoutIncluded =
    encodedLayout != undefined && encodedLayout.length <= MAX_SHARED_LAYOUT_LENGTH;
  if (layoutIncluded) {
    url.hash = LAYOUT_HASH_PREFIX + encodedLayout;
  }
  return { link: readableHref(url), layoutIncluded };
}
