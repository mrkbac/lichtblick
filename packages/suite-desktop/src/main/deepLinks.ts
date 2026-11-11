// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const LICHTBLICK_SCHEME = "lichtblick";
export const FOXGLOVE_SCHEME = "foxglove";

const LICHTBLICK_PREFIX = /^lichtblick:\/\//i;
// Only `foxglove://open` links share our query format; other hosts (sign-in etc.) are Foxglove's own.
const FOXGLOVE_OPEN_PREFIX = /^foxglove:\/\/(?=open(?:[/?#]|$))/i;

export type DeepLinkOptions = { acceptFoxglove: boolean };

/**
 * Returns `arg` as a `lichtblick://` deep link, or undefined if it isn't a deep link we handle.
 *
 * `foxglove://open?…` links are accepted only when `acceptFoxglove` is set. Their query
 * (`ds`, `ds.*`, `time`, …) uses the same names as ours, so only the scheme is rewritten.
 */
export function toLichtblickDeepLink(
  arg: string,
  { acceptFoxglove }: DeepLinkOptions,
): string | undefined {
  if (LICHTBLICK_PREFIX.test(arg)) {
    return arg;
  }
  if (acceptFoxglove && FOXGLOVE_OPEN_PREFIX.test(arg)) {
    return arg.replace(FOXGLOVE_OPEN_PREFIX, `${LICHTBLICK_SCHEME}://`);
  }
  return undefined;
}

/** All deep links in `args`, translated to `lichtblick://`. */
export function getDeepLinks(args: readonly string[], options: DeepLinkOptions): string[] {
  return args.flatMap((arg) => toLichtblickDeepLink(arg, options) ?? []);
}
