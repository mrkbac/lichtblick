// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MinHeap } from "./MinHeap.ts";

describe("MinHeap", () => {
  it("pops items in order after random pushes and in-place replaces", () => {
    let seed = 1;
    const random = () => (seed = (seed * 48271) % 2147483647);
    const heap = new MinHeap<{ value: number }>((a, b) => a.value - b.value);
    const values: number[] = [];
    for (let i = 0; i < 500; i++) {
      const value = random() % 1000;
      values.push(value);
      heap.push({ value });
    }
    // Change the top in place and sink it, as the reader does with chunk cursors.
    for (let i = 0; i < 200; i++) {
      const top = heap.peek()!;
      values.splice(values.indexOf(top.value), 1);
      top.value += random() % 1000;
      values.push(top.value);
      heap.replace(top);
    }
    const popped: number[] = [];
    for (let item; (item = heap.pop()); ) {
      popped.push(item.value);
    }
    expect(popped).toEqual(values.sort((a, b) => a - b));
    expect(heap.peek()).toBeUndefined();
  });
});
