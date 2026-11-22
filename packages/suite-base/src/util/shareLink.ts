// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

import { readableHref, updateAppURLState } from "@lichtblick/suite-base/util/appURLState";

/** Fragment key of a layout embedded in a share link: `#layout=<deflate-raw, base64url>` */
const LAYOUT_HASH_PREFIX = "layout=";

/**
 * Longest encoded layout a share link carries. The fragment never reaches a server, but chat apps
 * and issue trackers mangle very long links; bigger layouts are left out (the caller says so).
 */
export const MAX_SHARED_LAYOUT_LENGTH = 16_000;

async function pipe(bytes: BlobPart, stream: GenericTransformStream): Promise<Response> {
  return new Response(new Blob([bytes]).stream().pipeThrough(stream));
}

/** Compresses layout data into a URL-safe string. */
export async function encodeSharedLayout(data: unknown): Promise<string> {
  const compressed = await (
    await pipe(JSON.stringify(data) ?? "null", new CompressionStream("deflate-raw"))
  ).arrayBuffer();
  return new Uint8Array(compressed).toBase64({ alphabet: "base64url", omitPadding: true });
}

/** Reverses encodeSharedLayout, returning the layout's JSON text. */
export async function decodeSharedLayout(encoded: string): Promise<string> {
  const bytes = Uint8Array.fromBase64(encoded, { alphabet: "base64url" });
  return await (await pipe(bytes, new DecompressionStream("deflate-raw"))).text();
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

/**
 * A link that reopens the app's current source (already synced into `href`'s query) at `time`,
 * with the encoded layout in the fragment when given and small enough.
 */
export function buildShareLink(
  href: string,
  time: Time | undefined,
  encodedLayout: string | undefined,
): { link: string; layoutIncluded: boolean } {
  const url = updateAppURLState(new URL(href), { time });
  const layoutIncluded =
    encodedLayout != undefined && encodedLayout.length <= MAX_SHARED_LAYOUT_LENGTH;
  if (layoutIncluded) {
    // The embedded layout replaces a downloaded one; both would race to be selected.
    url.searchParams.delete("layoutUrl");
    url.hash = LAYOUT_HASH_PREFIX + encodedLayout;
  } else {
    url.hash = "";
  }
  return { link: readableHref(url), layoutIncluded };
}
