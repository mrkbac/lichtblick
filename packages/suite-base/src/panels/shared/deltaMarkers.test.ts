// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import DeltaMarkerBuilder from "@lichtblick/suite-base/testing/builders/DeltaMarkerBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

import { computeDelta, computeDeltaDisplay } from "./deltaMarkers";

describe("computeDelta", () => {
  const buildMarker = DeltaMarkerBuilder.marker;

  it("should compute the delta between the x values of both markers", () => {
    // Given
    const markerA = buildMarker({ xValue: 10 });
    const markerB = buildMarker({ xValue: 25 });

    // When
    const result = computeDelta(markerA, markerB);

    // Then
    expect(result.deltaX).toEqual(15);
  });

  it("should return a positive deltaX when marker B was placed before marker A in time", () => {
    // Given
    const markerA = buildMarker({ xValue: 25 });
    const markerB = buildMarker({ xValue: 10 });

    // When
    const result = computeDelta(markerA, markerB);

    // Then
    expect(result.deltaX).toEqual(15);
  });

  it("should compute deltaY between primary numeric values of both markers", () => {
    // Given
    const markerA = buildMarker({ seriesValues: [{ configIndex: 0, value: 5 }] });
    const markerB = buildMarker({ seriesValues: [{ configIndex: 0, value: 12 }] });

    // When
    const result = computeDelta(markerA, markerB);

    // Then
    expect(result.deltaY).toEqual(7);
  });

  it("should compute deltaY when markers belong to different series", () => {
    // Given
    const markerA = buildMarker({ seriesValues: [{ configIndex: 0, value: 10 }] });
    const markerB = buildMarker({ seriesValues: [{ configIndex: 1, value: 25 }] });

    // When
    const result = computeDelta(markerA, markerB);

    // Then
    expect(result.deltaY).toEqual(15);
  });

  it("should leave deltaY undefined when values are non-numeric", () => {
    // Given
    const markerA = buildMarker({ seriesValues: [{ configIndex: 0, value: "IDLE" }] });
    const markerB = buildMarker({ seriesValues: [{ configIndex: 0, value: "RUNNING" }] });

    // When
    const result = computeDelta(markerA, markerB);

    // Then
    expect(result.deltaY).toBeUndefined();
  });

  it("should leave deltaY undefined when markers have no series values", () => {
    // Given
    const markerA = buildMarker({ seriesValues: [] });
    const markerB = buildMarker({ seriesValues: [] });

    // When
    const result = computeDelta(markerA, markerB);

    // Then
    expect(result.deltaY).toBeUndefined();
  });
});

describe("computeDeltaDisplay", () => {
  const buildMarker = DeltaMarkerBuilder.marker;

  it("should return an undefined deltaX and deltaY until both markers are set", () => {
    // Given
    const markerA = buildMarker({ seriesValues: [{ configIndex: 0, value: 5 }] });

    // When / Then
    expect(computeDeltaDisplay(undefined, undefined)).toEqual({
      deltaX: undefined,
      deltaY: undefined,
    });
    expect(computeDeltaDisplay(markerA, undefined)).toEqual({
      deltaX: undefined,
      deltaY: undefined,
    });
    expect(computeDeltaDisplay(undefined, markerA)).toEqual({
      deltaX: undefined,
      deltaY: undefined,
    });
  });

  it("should delegate to computeDelta once both markers are set", () => {
    // Given
    const configIndex = BasicBuilder.number();
    const markerA = buildMarker({ xValue: 1, seriesValues: [{ configIndex, value: 5 }] });
    const markerB = buildMarker({ xValue: 4, seriesValues: [{ configIndex, value: 11 }] });

    // When
    const result = computeDeltaDisplay(markerA, markerB);

    // Then
    expect(result).toEqual(computeDelta(markerA, markerB));
  });
});
