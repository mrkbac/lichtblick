// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, Time } from "@foxglove/rostime";

import { LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { DiagnosticsById } from "@lichtblick/suite-base/panels/DiagnosticSummary/types";

/**
 * Keeps only diagnostics from `topics` (statuses from topics the user has hidden stay in the
 * reducer state) and marks those received before `staleTime` as STALE. Compares receive times
 * (not header stamps) so a publisher with a wrong or zero clock isn't reported stale. Entries that
 * aren't stale keep their identity so memoized rows don't re-render.
 */
export function getDiagnosticsWithStales(
  diagnostics: DiagnosticsById,
  staleTime: Time | undefined,
  topics: readonly string[],
): DiagnosticsById {
  const ret: DiagnosticsById = new Map();
  for (const [id, diagnostic] of diagnostics) {
    if (!topics.includes(diagnostic.topic)) {
      continue;
    }
    const stale = staleTime != undefined && compare(diagnostic.receiveTime, staleTime) < 0;
    ret.set(
      id,
      stale ? { ...diagnostic, status: { ...diagnostic.status, level: LEVELS.STALE } } : diagnostic,
    );
  }
  return ret;
}
