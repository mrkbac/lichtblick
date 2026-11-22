/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import {
  resetServiceWorkerUpdateStateForTests,
  setSaveSessionBeforeReload,
  takeResumePlayback,
} from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { UpdateIndicator } from "./UpdateIndicator";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const fakeWorker = () =>
  Object.assign(new EventTarget(), { state: "installed", postMessage: vi.fn() });

function mockRegistration(registration: { active?: unknown; waiting?: unknown }) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      controller: {},
      getRegistration: async () => Object.assign(new EventTarget(), registration),
    }),
  });
}

const renderIndicator = () =>
  render(
    <ThemeProvider isDark={false}>
      <UpdateIndicator />
    </ThemeProvider>,
  );

describe("UpdateIndicator", () => {
  beforeEach(() => {
    resetServiceWorkerUpdateStateForTests();
    sessionStorage.clear();
  });

  it("does not reload when another window applied the update, and marks it stale", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
    const waiting = fakeWorker();
    const registration: { active: unknown; waiting?: unknown } = { active: fakeWorker(), waiting };
    mockRegistration(registration);
    renderIndicator();
    expect((await screen.findByTestId("update-indicator")).dataset.updateKind).toBe("waiting");

    // another window activated it: nothing waits any more
    waiting.state = "activated";
    registration.waiting = undefined;
    act(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).not.toHaveBeenCalled();
    const button = screen.getByTestId("update-indicator");
    expect(button.dataset.updateKind).toBe("activated");
    fireEvent.click(button);
    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(waiting.postMessage).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("reloads when another window activates the update while this one saves", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
    let finishSave = () => {};
    const unregister = setSaveSessionBeforeReload(async () => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      return undefined;
    });
    const waiting = fakeWorker();
    mockRegistration({ active: fakeWorker(), waiting });
    renderIndicator();

    fireEvent.click(await screen.findByTestId("update-indicator"));
    waiting.state = "activated";
    act(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).not.toHaveBeenCalled();
    finishSave();
    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(waiting.postMessage).not.toHaveBeenCalled();
    unregister();
    vi.restoreAllMocks();
  });

  it("applies the waiting update only when clicked", async () => {
    const waiting = fakeWorker();
    mockRegistration({ active: fakeWorker(), waiting });
    renderIndicator();

    const button = await screen.findByTestId("update-indicator");
    expect(waiting.postMessage).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => {
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    });
  });

  it("updates to a newer version that replaced the waiting one during the save", async () => {
    let finishSave = () => {};
    const unregister = setSaveSessionBeforeReload(async () => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      return undefined;
    });
    const waiting = fakeWorker();
    const registration = { active: fakeWorker(), waiting };
    mockRegistration(registration);
    renderIndicator();

    fireEvent.click(await screen.findByTestId("update-indicator"));
    const newer = fakeWorker();
    waiting.state = "redundant";
    registration.waiting = newer;
    finishSave();
    await waitFor(() => {
      expect(newer.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    });
    expect(waiting.postMessage).not.toHaveBeenCalled();
    unregister();
  });

  it("saves the session before updating, and stores what to resume only when reloading", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
    let finishSave = () => {};
    const unregister = setSaveSessionBeforeReload(async () => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      return "source";
    });
    const waiting = fakeWorker();
    mockRegistration({ active: fakeWorker(), waiting });
    renderIndicator();

    fireEvent.click(await screen.findByTestId("update-indicator"));
    await Promise.resolve();
    expect(waiting.postMessage).not.toHaveBeenCalled();
    finishSave();
    await waitFor(() => {
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    });
    // the activation may still fail: a manual reload now must not resume playback
    expect(sessionStorage.length).toBe(0);
    act(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeResumePlayback()).toBe("source");
    unregister();
    vi.restoreAllMocks();
  });

  it("keeps showing a stale window's button after a remount", async () => {
    mockRegistration({ active: fakeWorker(), waiting: fakeWorker() });
    const { unmount } = renderIndicator();
    await screen.findByTestId("update-indicator");
    act(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    unmount();
    mockRegistration({ active: fakeWorker() }); // nothing waits any more
    renderIndicator();
    expect(screen.getByTestId("update-indicator").dataset.updateKind).toBe("activated");
  });

  it("forgets a requested update that never activated", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
    const unregister = setSaveSessionBeforeReload(async () => "source");
    const waiting = fakeWorker();
    mockRegistration({ active: fakeWorker(), waiting });
    renderIndicator();

    fireEvent.click(await screen.findByTestId("update-indicator"));
    await waitFor(() => {
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    });
    waiting.state = "redundant";
    waiting.dispatchEvent(new Event("statechange"));
    // later another window updates: this one must not reload unasked, nor resume playback
    act(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).not.toHaveBeenCalled();
    expect(takeResumePlayback()).toBeUndefined();
    expect(screen.getByTestId("update-indicator").dataset.updateKind).toBe("activated");
    unregister();
    vi.restoreAllMocks();
  });

  it("runs one update at a time however often the button is clicked", async () => {
    const save = vi.fn(async () => {
      await new Promise(() => {}); // still saving
      return undefined;
    });
    const unregister = setSaveSessionBeforeReload(save);
    mockRegistration({ active: fakeWorker(), waiting: fakeWorker() });
    renderIndicator();

    const button = await screen.findByTestId("update-indicator");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("lets the user try again when the update fails", async () => {
    const save = vi.fn(async () => undefined);
    const unregister = setSaveSessionBeforeReload(save);
    const waiting = fakeWorker();
    mockRegistration({ active: fakeWorker(), waiting });
    renderIndicator();
    const button = await screen.findByTestId("update-indicator");
    // a newer deploy replaced it, and looking up the newer one fails
    waiting.state = "redundant";
    Object.assign(navigator.serviceWorker, {
      getRegistration: async () => await Promise.reject(new Error("lookup failed")),
    });

    fireEvent.click(button);
    await waitFor(() => {
      expect(console.warn).toHaveBeenCalled();
    });
    (console.warn as Mock).mockClear();
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(console.warn).toHaveBeenCalled(); // the retry fails the same way
    });
    (console.warn as Mock).mockClear();
    unregister();
  });

  it("updates a stale window to a newer waiting version, not the intermediate one", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
    const registration: { active: unknown; waiting?: unknown } = { active: fakeWorker() };
    mockRegistration(registration);
    renderIndicator();
    act(() => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    });
    const button = screen.getByTestId("update-indicator");
    expect(button.dataset.updateKind).toBe("activated");
    // a newer deploy is waiting by the time the user clicks
    const newer = fakeWorker();
    registration.waiting = newer;

    fireEvent.click(button);
    await waitFor(() => {
      expect(newer.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    });
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("stays hidden on the very first install", async () => {
    mockRegistration({ waiting: fakeWorker() });
    renderIndicator();
    await Promise.resolve();
    expect(screen.queryByTestId("update-indicator")).toBeNull();
  });
});
