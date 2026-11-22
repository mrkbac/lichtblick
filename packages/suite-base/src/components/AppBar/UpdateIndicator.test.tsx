/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { setSaveSessionBeforeReload } from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";
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
  // first: once any window here applies an update, module state marks it as requested
  it("does not reload when another window applied the update, and marks it stale", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
    const waiting = fakeWorker();
    mockRegistration({ active: fakeWorker(), waiting });
    renderIndicator();
    expect((await screen.findByTestId("update-indicator")).dataset.updateKind).toBe("waiting");

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

  // also before any test applies an update here (module state)
  it("reloads when another window activates the update while this one saves", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
    let finishSave = () => {};
    const unregister = setSaveSessionBeforeReload(async () => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
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

  it("saves the session before updating", async () => {
    let finishSave = () => {};
    const unregister = setSaveSessionBeforeReload(async () => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
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
    unregister();
  });

  it("stays hidden on the very first install", async () => {
    mockRegistration({ waiting: fakeWorker() });
    renderIndicator();
    await Promise.resolve();
    expect(screen.queryByTestId("update-indicator")).toBeNull();
  });
});
