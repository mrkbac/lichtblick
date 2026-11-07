/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";

import { useInstallPrompt } from "./useInstallPrompt";

describe("useInstallPrompt", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => {
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    vi.unstubAllGlobals();
  });

  it("uses native install when available, only after an installability event", async () => {
    const install = vi.fn().mockResolvedValue({});
    vi.stubGlobal("navigator", { install });
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current).toBeUndefined();
    const prompt = vi.fn();
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt }));
    });
    await act(async () => {
      result.current?.();
    });
    expect(install).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it("handles cancellation without an unhandled rejection", async () => {
    vi.stubGlobal("navigator", {
      install: vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn() }));
    });
    await act(async () => {
      result.current?.();
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("clears the offer after installation", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn() }));
    });
    expect(result.current).toBeDefined();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current).toBeUndefined();
  });

  it("reports installation failures", async () => {
    const failure = new DOMException("Blocked", "NotAllowedError");
    vi.stubGlobal("navigator", { install: vi.fn().mockRejectedValue(failure) });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn() }));
    });
    await act(async () => {
      result.current?.();
    });
    expect(error).toHaveBeenCalledWith("App installation failed", failure);
    error.mockClear();
  });

  it("suppresses installation in an installed Chromium app", () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn() }));
    });
    expect(result.current).toBeUndefined();
  });

  it("suppresses installation in the desktop app", () => {
    vi.stubGlobal("desktopBridge", {});
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn() }));
    });
    expect(result.current).toBeUndefined();
  });

  it("suppresses installation in a standalone Safari app", () => {
    vi.stubGlobal("navigator", { standalone: true });
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn() }));
    });
    expect(result.current).toBeUndefined();
  });

  it("offers install once the browser fires beforeinstallprompt, and prompts only once", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current).toBeUndefined();

    const prompt = vi.fn().mockResolvedValue({ outcome: "accepted" });
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
