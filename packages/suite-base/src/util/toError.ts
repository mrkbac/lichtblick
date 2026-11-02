// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Narrows a caught value (`unknown` under useUnknownInCatchVariables) to an Error. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
