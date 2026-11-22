// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Transform } from "./Transform";
import { TransformHistory } from "./TransformHistory";

const at = (x: number) => new Transform([x, 0, 0], [0, 0, 0, 1]);
const xAt = (history: TransformHistory, index: number) =>
  history.transformAt(index, Transform.Empty()).position()[0];

describe("TransformHistory", () => {
  it("keeps samples sorted and replaces equal times", () => {
    const history = new TransformHistory();
    for (const t of [5, 1, 3, 9, 7]) {
      history.set(BigInt(t), at(t));
    }
    history.set(3n, at(33));
    expect(history.size()).toBe(5);
    expect([0, 1, 2, 3, 4].map((i) => history.timeAt(i))).toEqual([1n, 3n, 5n, 7n, 9n]);
    expect(xAt(history, 1)).toBe(33);
    expect(history.binarySearch(4n)).toBe(~2);
  });

  it("stores a run of equal transforms as its first and last sample", () => {
    const history = new TransformHistory();
    for (let t = 0n; t < 100n; t++) {
      history.set(t, at(1));
    }
    history.set(100n, at(2));
    expect(history.size()).toBe(3);
    expect([history.timeAt(0), history.timeAt(1), history.timeAt(2)]).toEqual([0n, 99n, 100n]);
  });

  it("keeps recording-scale nanosecond times exact", () => {
    const history = new TransformHistory();
    const base = 1_700_000_000_123_456_789n;
    history.set(base, at(0));
    history.set(base + 1n, at(1));
    expect(history.timeAt(1)).toBe(base + 1n);
    expect(history.binarySearch(base + 1n)).toBe(1);
  });

  it("removes samples", () => {
    const history = new TransformHistory();
    for (let t = 0; t < 10; t++) {
      history.set(BigInt(t), at(t));
    }
    expect(history.remove(4n)).toBe(true);
    expect(history.remove(4n)).toBe(false);
    history.removeFirst(3);
    expect(history.size()).toBe(6);
    expect(history.timeAt(0)).toBe(3n);
    expect(history.timeAt(1)).toBe(5n);
  });

  it("decimates to every other sample, keeping the first and last", () => {
    const history = new TransformHistory();
    for (let t = 0; t < 10; t++) {
      history.set(BigInt(t), at(t));
    }
    expect(history.decimate()).toBe(4);
    expect([0, 1, 2, 3, 4, 5].map((i) => history.timeAt(i))).toEqual([0n, 2n, 4n, 6n, 8n, 9n]);
  });

  it("never shows a sample received after the cutoff, even when stamps arrive out of order", () => {
    const history = new TransformHistory();
    // stamp 20 received at 50, then stamp 10 received at 100
    history.set(20n, at(20), 50n);
    history.set(10n, at(10), 100n);
    expect(history.receivedCount(75n)).toBe(0);
    expect(history.receivedCount(100n)).toBe(2);
  });

  it("keeps the first receive time when the same transform is received again", () => {
    const history = new TransformHistory();
    history.set(5n, at(1), 10n);
    history.set(5n, at(1), 20n);
    expect(history.receivedCount(15n)).toBe(1);
    // A different transform at the same stamp replaces it from its own receive time
    history.set(5n, at(2), 30n);
    expect(history.receivedCount(25n)).toBe(0);
  });

  it("finds the same index as a linear scan for steady and irregular rates", () => {
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const irregular of [false, true]) {
      const history = new TransformHistory();
      const times: bigint[] = [];
      let t = 1000n;
      for (let i = 0; i < 500; i++) {
        t += irregular ? BigInt(1 + Math.floor(random() ** 4 * 10_000)) : 10n;
        times.push(t);
        history.set(t, at(i));
      }
      for (let q = 0n; q < t + 20n; q += irregular ? 7n : 3n) {
        const idx = times.findIndex((time) => time >= q);
        const expected = idx === -1 ? ~times.length : times[idx] === q ? idx : ~idx;
        expect(history.binarySearch(q)).toBe(expected);
      }
    }
  });

  it("releases storage after thinning and pruning", () => {
    const history = new TransformHistory();
    for (let t = 0; t < 1000; t++) {
      history.set(BigInt(t), at(t));
    }
    history.decimate();
    history.decimate();
    expect(history.capacity()).toBeLessThan(2 * history.size());
    history.removeFirst(history.size() - 10);
    expect(history.capacity()).toBeLessThan(2 * history.size());
    // Pruned from the front and refilled, it compacts instead of growing
    for (let t = 1000; t < 5000; t++) {
      history.set(BigInt(t), at(t));
      history.removeOlderThan(100);
    }
    expect(history.capacity()).toBeLessThan(2 * history.size());
    expect(history.timeAt(history.size() - 1)).toBe(4999n);
    expect(history.timeAt(0)).toBeLessThanOrEqual(4899n);
  });
});
