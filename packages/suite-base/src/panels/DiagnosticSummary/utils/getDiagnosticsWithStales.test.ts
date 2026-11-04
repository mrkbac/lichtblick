// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@lichtblick/rostime";
import { DiagnosticInfo } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { DiagnosticsById } from "@lichtblick/suite-base/panels/DiagnosticSummary/types";
import { getDiagnosticsWithStales } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/getDiagnosticsWithStales";
import DiagnosticsBuilder from "@lichtblick/suite-base/testing/builders/DiagnosticsBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

describe("getDiagnosticsWithStales", () => {
  const staleTime: Time = { sec: 100, nsec: 0 };

  const createDiagnosticInfo = (receiveTime: Time, level: number = LEVELS.WARN): DiagnosticInfo =>
    DiagnosticsBuilder.info({
      receiveTime,
      // header stamp from a broken robot clock must not matter
      stamp: { sec: 0, nsec: 0 },
      status: { ...DiagnosticsBuilder.statusMessage(), level },
    });

  it("marks diagnostics received before staleTime as STALE", () => {
    const id = BasicBuilder.string();
    const diagnostics: DiagnosticsById = new Map([
      [id, createDiagnosticInfo({ sec: 50, nsec: 0 }, LEVELS.ERROR)],
    ]);

    const result = getDiagnosticsWithStales(diagnostics, staleTime);

    expect(result.get(id)?.status.level).toBe(LEVELS.STALE);
    // input untouched
    expect(diagnostics.get(id)?.status.level).toBe(LEVELS.ERROR);
  });

  it("uses receive time, not header stamp, and keeps identity of fresh entries", () => {
    const id = BasicBuilder.string();
    const fresh = createDiagnosticInfo({ sec: 150, nsec: 0 }, LEVELS.OK);
    const diagnostics: DiagnosticsById = new Map([[id, fresh]]);

    const result = getDiagnosticsWithStales(diagnostics, staleTime);

    expect(result.get(id)).toBe(fresh);
  });

  it("returns the input when staleness is disabled", () => {
    const diagnostics: DiagnosticsById = new Map([
      [BasicBuilder.string(), createDiagnosticInfo({ sec: 1, nsec: 0 })],
    ]);

    expect(getDiagnosticsWithStales(diagnostics, undefined)).toBe(diagnostics);
  });
});
