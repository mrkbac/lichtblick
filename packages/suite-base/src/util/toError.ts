// SPDX-License-Identifier: MPL-2.0

/** Narrows a caught value (`unknown` under useUnknownInCatchVariables) to an Error. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
