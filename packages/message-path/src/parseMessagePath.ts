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

import { Grammar, Parser } from "nearley";

import grammar from "./grammar.ne";
import { STREAM_MODIFIERS } from "./modifiers";
import { MessagePath, MessagePathModifier, MessagePathPart } from "./types";

const grammarObj = Grammar.fromCompiled(grammar);

/** Wrap topic name in double quotes if it contains special characters */
export function quoteTopicNameIfNeeded(name: string): string {
  // Pattern should match `slashID` in grammar.ne
  if (name.match(/^[a-zA-Z0-9_/-]+$/)) {
    return name;
  }
  return `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

/** Wrap field name in double quotes if it contains special characters */
export function quoteFieldNameIfNeeded(name: string): string {
  // Pattern should match `id` in grammar.ne
  if (name.match(/^[a-zA-Z0-9_-]+$/)) {
    return name;
  }
  return `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

function isStreamModifier(part: MessagePathPart): boolean {
  return part.type === "modifier" && part.args.length === 0 && STREAM_MODIFIERS.includes(part.name);
}

const CacheMessagePath: Record<string, MessagePath> = {};

const parseMessagePath = (path: string): MessagePath | undefined => {
  // Cache the parsed message path to avoid re-parsing the same path
  if (CacheMessagePath[path]) {
    return CacheMessagePath[path];
  }

  const parser = new Parser(grammarObj);
  try {
    const result: MessagePath | undefined = parser.feed(path).results[0];
    // A time-series modifier like `.@derivative` is computed across messages. At most one is
    // allowed, and only modifiers may follow it. Inputs check that those are scalar.
    const parts = result?.messagePath ?? [];
    const index = parts.findIndex(isStreamModifier);
    if (result && index !== -1) {
      const after = parts.slice(index + 1);
      if (!after.every((part) => part.type === "modifier" && !isStreamModifier(part))) {
        return undefined;
      }
      result.modifier = (parts[index] as MessagePathModifier).name;
      if (after.length > 0) {
        result.modifiersAfter = after as MessagePathModifier[];
      }
      result.messagePath = parts.slice(0, index);
    }
    if (result) {
      CacheMessagePath[path] = result;
    }
    return result;
  } catch (err: unknown) {
    console.error("Error parsing message path", err);
    return undefined;
  }
};

export { parseMessagePath };
