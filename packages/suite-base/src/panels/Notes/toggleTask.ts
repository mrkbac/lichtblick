// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Matches a list-item marker followed by a task box, e.g. "- [ ]", "* [x]", "1. [X]".
const TASK_RE = /^((?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/;

/**
 * Flip the task box of the list item starting at `offset` in the Markdown `text`.
 * Returns `text` unchanged when there is no task box at that offset.
 */
export function toggleTask(text: string, offset: number): string {
  const match = TASK_RE.exec(text.slice(offset));
  if (match == undefined) {
    return text;
  }
  const index = offset + match[1]!.length;
  return text.slice(0, index) + (match[2] === " " ? "x" : " ") + text.slice(index + 1);
}
