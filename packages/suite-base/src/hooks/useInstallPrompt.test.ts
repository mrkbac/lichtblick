/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";

import { useInstallPrompt } from "./useInstallPrompt";

describe("useInstallPrompt", () => {
  it("offers install once the browser fires beforeinstallprompt, and prompts only once", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current).toBeUndefined();

    const prompt = jest.fn().mockResolvedValue({ outcome: "accepted" });
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt }));
    });
    expect(result.current).toBeDefined();

    act(() => {
      result.current?.();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current).toBeUndefined();
  });
});
