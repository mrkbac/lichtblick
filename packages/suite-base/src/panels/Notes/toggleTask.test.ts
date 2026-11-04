// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toggleTask } from "./toggleTask";

describe("toggleTask", () => {
  it.each([
    ["- [ ] a", 0, "- [x] a"],
    ["* [x] a", 0, "* [ ] a"],
    ["1. [X] a", 0, "1. [ ] a"],
    ["- [ ] a\n  - [ ] b", 10, "- [ ] a\n  - [x] b"],
    ["- plain", 0, "- plain"],
  ])("%j at %d -> %j", (text, offset, expected) => {
    expect(toggleTask(text, offset)).toBe(expected);
  });
});
