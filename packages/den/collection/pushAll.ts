// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Append `items` to `target` in place. Unlike `target.push(...items)` it works for any length:
 * spreading passes every item as a call argument and throws RangeError around 100k items.
 */
export function pushAll<T>(target: T[], items: Iterable<T>): void {
  // Appending to the array being iterated would never end
  const source = items === target ? target.slice() : items;
  for (const item of source) {
    target.push(item);
  }
}
