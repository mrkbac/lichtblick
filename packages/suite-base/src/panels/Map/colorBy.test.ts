// SPDX-License-Identifier: MPL-2.0

import { normalize, sampleAt, speedValues, valueRange } from "./colorBy";
import { offsetMeters } from "./geo";
import { SampleStore, TrackStore } from "./track";

function track(fixes: readonly { time: number; position: [number, number] }[]): TrackStore {
  const store = new TrackStore("/fix");
  for (const { time, position } of fixes) {
    store.push({
      topic: "/fix",
      schemaName: "sensor_msgs/NavSatFix",
      receiveTime: { sec: Math.floor(time), nsec: Math.round((time % 1) * 1e9) },
      sizeInBytes: 0,
      message: { longitude: position[0], latitude: position[1] },
    });
  }
  return store;
}

describe("colorBy", () => {
  it("computes speed over a time window", () => {
    // 10 m/s east, sampled at 10 Hz.
    const fixes = Array.from({ length: 20 }, (_, i) => ({
      time: i / 10,
      position: offsetMeters([8, 47], i, 0),
    }));
    const speeds = speedValues(track(fixes), "metric");
    expect(speeds).toHaveLength(20);
    for (const speed of speeds) {
      expect(speed).toBeCloseTo(36, 1); // km/h
    }
    expect([...speedValues(track([fixes[0]!]), "metric")]).toEqual([NaN]);
  });

  it("looks up the latest sample at or before each time", () => {
    const samples = new SampleStore();
    samples.push(1, 10);
    samples.push(2, 20);
    const fixes = track([0.5, 1, 1.5, 2, 9].map((time) => ({ time, position: [0, 0] })));
    expect([...sampleAt(samples, fixes)]).toEqual([NaN, 10, 10, 20, 20]);
    expect([...sampleAt(undefined, fixes)]).toEqual([NaN, NaN, NaN, NaN, NaN]);
  });

  it("derives a robust range unless bounds are given", () => {
    const values = [...Array.from({ length: 100 }, (_, i) => i), 10_000, NaN];
    expect(valueRange(values, undefined, undefined)).toEqual([2, 98]);
    expect(valueRange(values, 0, 50)).toEqual([0, 50]);
    expect(valueRange([5, 5], undefined, undefined)).toEqual([5, 6]);
    expect(valueRange([NaN], undefined, undefined)).toBeUndefined();
    expect(normalize(150, [50, 100])).toBe(1);
    expect(normalize(75, [50, 100])).toBe(0.5);
  });
});
