/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { sanitize } from "./sanitize";

describe("sanitize", () => {
  it("keeps allowed markup and drops scripts, handlers and other attributes", () => {
    expect(
      sanitize(
        '<b onclick="x()">ok</b><script>alert(1)</script><font color="red" style="x">hi</font><td colspan="2">c</td><img src=x onerror=alert(1)>',
      ),
    ).toEqual({ __html: '<b>ok</b><font color="red">hi</font>c' });
  });
});
