// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Fzf } from "fzf";
import { useMemo } from "react";

type Props = {
  str: string;
  /** Code point positions to highlight, e.g. Fzf result positions. */
  indices: ReadonlySet<number>;
  /** Added to each index before the lookup, for when `str` is a suffix of the matched string. */
  offset?: number;
  /** Class for the highlighted runs; defaults to the browser's <mark> style. */
  highlightClassName?: string;
};

/** Fuzzy match positions of `query` in `str`, as used by Fzf-based search. */
export function fuzzyPositions(str: string, query: string | undefined): ReadonlySet<number> {
  if (!query) {
    return new Set();
  }
  return new Fzf([str], { casing: "case-insensitive" }).find(query)[0]?.positions ?? new Set();
}

/** Positions of every case-insensitive occurrence of `query` in `str`. */
export function substringPositions(str: string, query: string | undefined): ReadonlySet<number> {
  const positions = new Set<number>();
  if (!query?.trim()) {
    return positions;
  }
  const lower = (char: string) => char.toLowerCase();
  const needle = Array.from(query, lower);
  const chars = Array.from(str, lower);
  for (let start = 0; start + needle.length <= chars.length; ) {
    if (needle.every((char, i) => chars[start + i] === char)) {
      for (let i = 0; i < needle.length; i++) {
        positions.add(start + i);
      }
      start += needle.length;
    } else {
      start++;
    }
  }
  return positions;
}

/**
 * Renders `str` with the characters at `indices` wrapped in <mark>, one element per
 * consecutive run.
 */
export function HighlightChars(props: Props): React.JSX.Element {
  const { str, indices, offset = 0, highlightClassName } = props;

  const nodes = useMemo(() => {
    const runs: { text: string; matched: boolean }[] = [];
    // fzf positions index code points, so iterate code points rather than UTF-16 units
    for (const [i, char] of Array.from(str).entries()) {
      const matched = indices.has(i + offset);
      const last = runs.at(-1);
      if (last?.matched === matched) {
        last.text += char;
      } else {
        runs.push({ text: char, matched });
      }
    }
    return runs.map((run, i) =>
      run.matched ? (
        <mark key={i} className={highlightClassName}>
          {run.text}
        </mark>
      ) : (
        run.text
      ),
    );
  }, [highlightClassName, indices, offset, str]);

  return <span>{nodes}</span>;
}
