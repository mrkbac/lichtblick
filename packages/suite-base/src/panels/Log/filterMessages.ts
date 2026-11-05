// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { LogLevel, NormalizedLogMessage, VisibilityFilter } from "./types";

type Matcher = (text: string) => boolean;

export type CompiledSearch = {
  /** A message matches if any include term matches (or there are none) */
  include: Matcher[];
  /** A message is hidden if any exclude term (`-term`) matches */
  exclude: Matcher[];
  /** Terms that are not valid regular expressions */
  invalidTerms: string[];
};

/**
 * Compile search terms into matchers. A term starting with `-` excludes matches.
 * Terms are substrings by default, or regular expressions when `regex` is set.
 */
export function compileSearch(
  terms: readonly string[],
  { regex = false, caseSensitive = false }: { regex?: boolean; caseSensitive?: boolean },
): CompiledSearch {
  const result: CompiledSearch = { include: [], exclude: [], invalidTerms: [] };
  for (const rawTerm of terms) {
    const negate = rawTerm.length > 1 && rawTerm.startsWith("-");
    const term = negate ? rawTerm.slice(1) : rawTerm;
    if (term.length === 0) {
      continue;
    }
    let matcher: Matcher;
    if (regex) {
      try {
        const re = new RegExp(term, caseSensitive ? "" : "i");
        matcher = (text) => re.test(text);
      } catch {
        result.invalidTerms.push(rawTerm);
        continue;
      }
    } else if (caseSensitive) {
      matcher = (text) => text.includes(term);
    } else {
      const lower = term.toLowerCase();
      matcher = (text) => text.toLowerCase().includes(lower);
    }
    (negate ? result.exclude : result.include).push(matcher);
  }
  return result;
}

export type LogFilter = {
  minLogLevel: number;
  search: CompiledSearch;
  nameFilter: VisibilityFilter;
};

export default function filterMessages(
  items: readonly NormalizedLogMessage[],
  { minLogLevel, search, nameFilter }: LogFilter,
): readonly NormalizedLogMessage[] {
  const { include, exclude } = search;
  const hasHiddenNames = Object.values(nameFilter).some(({ visible }) => visible === false);
  // return all messages if we wouldn't filter anything
  if (
    minLogLevel <= LogLevel.DEBUG &&
    include.length === 0 &&
    exclude.length === 0 &&
    !hasHiddenNames
  ) {
    return items;
  }

  const matches = (matcher: Matcher, item: NormalizedLogMessage) =>
    matcher(item.message) || (item.name != undefined && matcher(item.name));

  return items.filter((item) => {
    // ">= DEBUG" shows everything, including messages with an unknown level
    if (minLogLevel > LogLevel.DEBUG && item.level < minLogLevel) {
      return false;
    }
    if (item.name != undefined && nameFilter[item.name]?.visible === false) {
      return false;
    }
    if (exclude.some((m) => matches(m, item))) {
      return false;
    }
    return include.length === 0 || include.some((m) => matches(m, item));
  });
}
