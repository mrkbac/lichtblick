// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, Time } from "@foxglove/rostime";

import { LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { DiagnosticsById } from "@lichtblick/suite-base/panels/DiagnosticSummary/types";

/**
 * Marks diagnostics received before `staleTime` as STALE. Compares receive times (not header
 * stamps) so a publisher with a wrong or zero clock isn't reported stale. Entries that aren't
 * stale keep their identity so memoized rows don't re-render.
 */
export function getDiagnosticsWithStales(
  diagnostics: DiagnosticsById,
  staleTime: Time | undefined,
): DiagnosticsById {
  if (!staleTime) {
    return diagnostics;
  }
  const ret: DiagnosticsById = new Map();
  for (const [id, diagnostic] of diagnostics) {
    const stale = compare(diagnostic.receiveTime, staleTime) < 0;
    ret.set(
      id,
      stale ? { ...diagnostic, status: { ...diagnostic.status, level: LEVELS.STALE } } : diagnostic,
    );
  }
  return ret;
}
