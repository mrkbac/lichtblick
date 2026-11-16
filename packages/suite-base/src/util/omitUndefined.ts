// SPDX-License-Identifier: MPL-2.0

/** A shallow copy of `obj` without the keys whose value is undefined (null values are kept). */
export function omitUndefined<T extends object>(obj: T): T {
  // eslint-disable-next-line @lichtblick/strict-equality
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}
