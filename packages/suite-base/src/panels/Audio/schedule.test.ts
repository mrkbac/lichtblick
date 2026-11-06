// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MAX_DRIFT_SEC, MIN_LEAD_SEC, planChunk } from "./schedule";

describe("planChunk", () => {
  it("starts the first chunk at its ideal time", () => {
    expect(planChunk({ now: 10, nextStart: undefined, idealStart: 10.2, duration: 0.1 })).toEqual({
      kind: "play",
      start: 10.2,
      skip: 0,
      cut: false,
    });
  });

  it("plays chunks back to back while they stay near the playhead", () => {
    const plan = planChunk({ now: 10, nextStart: 10.3, idealStart: 10.35, duration: 0.1 });
    expect(plan).toEqual({ kind: "play", start: 10.3, skip: 0, cut: false });
  });

  it("cuts queued audio and re-syncs when playback jumps", () => {
    const plan = planChunk({ now: 10, nextStart: 10.3, idealStart: 11, duration: 0.1 });
    expect(plan).toEqual({ kind: "play", start: 11, skip: 0, cut: true });
    expect(11 - 10.3).toBeGreaterThan(MAX_DRIFT_SEC);
  });

  it("restarts without a cut after the queue ran dry", () => {
    const plan = planChunk({ now: 10, nextStart: 9.9, idealStart: 10.2, duration: 0.1 });
    expect(plan).toMatchObject({ start: 10.2, cut: false });
  });

  it("skips the part of a late chunk that is already in the past", () => {
    const plan = planChunk({ now: 10, nextStart: undefined, idealStart: 9.9, duration: 0.5 });
    expect(plan).toMatchObject({ kind: "play", start: 10 + MIN_LEAD_SEC });
    expect(plan.kind === "play" && plan.skip).toBeCloseTo(0.1 + MIN_LEAD_SEC);
  });

  it("drops chunks that are entirely in the past", () => {
    expect(planChunk({ now: 10, nextStart: undefined, idealStart: 9, duration: 0.5 })).toEqual({
      kind: "drop",
    });
  });
});
