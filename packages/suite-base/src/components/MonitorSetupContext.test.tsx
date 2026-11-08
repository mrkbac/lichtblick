/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactElement, useEffect } from "react";

import { LOCAL_STORAGE_MONITOR_SETUP } from "@lichtblick/suite-base/constants/browserStorageKeys";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import LayoutManagerContext from "@lichtblick/suite-base/context/LayoutManagerContext";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import MockLayoutManager from "@lichtblick/suite-base/services/LayoutManager/MockLayoutManager";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { MonitorSetupButtons } from "./AppBar/MonitorSetupButtons";
import { MonitorSetupProvider, useMonitorSetup } from "./MonitorSetupContext";
import { ManagedScreen, WindowBounds } from "./monitorSetup";

const layouts = new MockLayoutManager();
function renderThemed(element: ReactElement) {
  return render(
    <ThemeProvider isDark>
      <LayoutManagerContext.Provider value={layouts}>{element}</LayoutManagerContext.Provider>
    </ThemeProvider>,
  );
}

const open = vi.fn();
let child: Window | undefined;
const getWindow = () => child;
const selectLayoutId = (state: LayoutState) => state.selectedLayout?.id;
function Controls() {
  const setup = useMonitorSetup();
  const register = setup?.register;
  const id = useCurrentLayoutSelector(selectLayoutId);
  useEffect(() => register?.("Tab!one", { open, getWindow }), [register, id]);
  return (
    <>
      <MonitorSetupButtons disabled={false} />
    </>
  );
}
function Wrapper() {
  return (
    <MockCurrentLayoutProvider>
      <MonitorSetupProvider>
        <Controls />
      </MonitorSetupProvider>
    </MockCurrentLayoutProvider>
  );
}
function makeChild() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const target = iframe.contentWindow!;
  vi.spyOn(target, "close").mockImplementation(() => {});
  Object.defineProperties(target, {
    screenX: { value: 30 },
    screenY: { value: 50 },
    outerWidth: { value: 800 },
    outerHeight: { value: 600 },
  });
  return target;
}

beforeEach(() => {
  child = undefined;
  open.mockReset();
  layouts.updateLayout.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll("iframe").forEach((iframe) => {
    iframe.remove();
  });
});

it("saves per layout locally and restores only after one explicit click", async () => {
  child = makeChild();
  const handle = renderThemed(<Wrapper />);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("save-monitor-setup"));
  await waitFor(() => {
    expect(screen.getByTestId("restore-monitor-setup").hasAttribute("disabled")).toBe(false);
  });
  expect(localStorage.getItem(`${LOCAL_STORAGE_MONITOR_SETUP}mock-layout`)).toContain("Tab!one");
  handle.unmount();
  child = undefined;
  renderThemed(<Wrapper />);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("restore-monitor-setup"));
  await waitFor(() => {
    expect(open).toHaveBeenCalledTimes(1);
  });
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining<Partial<WindowBounds>>({ width: 800, height: 600 }),
  );
});

it("opens a blank window immediately and adds an empty persistent Tab container", async () => {
  const target = makeChild();
  const windowOpen = vi.spyOn(window, "open").mockReturnValue(target);
  const onAction = vi.fn();
  renderThemed(
    <MockCurrentLayoutProvider onAction={onAction}>
      <MonitorSetupProvider>
        <Controls />
      </MonitorSetupProvider>
    </MockCurrentLayoutProvider>,
  );
  fireEvent.click(screen.getByTestId("new-window-button"));
  expect(windowOpen).toHaveBeenCalledWith("about:blank", "_blank", "popup,width=1000,height=700");
  expect(onAction).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "ADD_PANEL",
      payload: expect.objectContaining({
        config: expect.objectContaining({ isWindow: true, tabs: [{ title: "1" }] }),
      }),
    }),
  );
  // The new layout owns the panel; it is not a second app instance or a duplicated player.
});

it("does not change the layout when the browser blocks the new window", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const onAction = vi.fn();
  renderThemed(
    <MockCurrentLayoutProvider onAction={onAction}>
      <MonitorSetupProvider>
        <Controls />
      </MonitorSetupProvider>
    </MockCurrentLayoutProvider>,
  );
  fireEvent.click(screen.getByTestId("new-window-button"));
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Could not open a window");
});

it("reports a storage failure without losing open windows", async () => {
  child = makeChild();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota", "QuotaExceededError");
  });
  renderThemed(<Wrapper />);
  fireEvent.click(screen.getByTestId("save-monitor-setup"));
  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toContain("Could not save monitor setup");
  });
  expect(open).not.toHaveBeenCalled();
});

it("has no monitor controls or browser calls in desktop mode", () => {
  vi.stubGlobal("desktopBridge", {});
  const windowOpen = vi.spyOn(window, "open");
  renderThemed(<Wrapper />);
  expect(screen.queryByTestId("new-window-button")).toBeNull();
  expect(windowOpen).not.toHaveBeenCalled();
});

it("does not restore into a departed workspace after a screen permission prompt resolves", async () => {
  localStorage.setItem(
    `${LOCAL_STORAGE_MONITOR_SETUP}mock-layout`,
    JSON.stringify([
      { panelId: "Tab!one", bounds: { left: 30, top: 50, width: 800, height: 600 } },
    ])!,
  );
  let finish!: (details: { screens: ManagedScreen[] }) => void;
  Object.defineProperty(window, "getScreenDetails", {
    configurable: true,
    value: async () =>
      await new Promise<{ screens: ManagedScreen[] }>((resolve) => {
        finish = resolve;
      }),
  });
  const view = renderThemed(<Wrapper />);
  fireEvent.click(screen.getByTestId("restore-monitor-setup"));
  view.unmount();
  await act(async () => {
    finish({ screens: [] });
  });
  expect(open).not.toHaveBeenCalled();
  Reflect.deleteProperty(window, "getScreenDetails");
});

it("confirms a monitor save only after its panel contents reach the local working copy", async () => {
  child = makeChild();
  let finish!: () => void;
  layouts.updateLayout.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  renderThemed(<Wrapper />);
  fireEvent.click(screen.getByTestId("save-monitor-setup"));
  await waitFor(() => {
    expect(layouts.updateLayout).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mock-layout", data: expect.anything() }),
    );
  });
  expect(localStorage.getItem(`${LOCAL_STORAGE_MONITOR_SETUP}mock-layout`)).toBeNull();
  await act(async () => {
    finish();
  });
  await waitFor(() => {
    expect(localStorage.getItem(`${LOCAL_STORAGE_MONITOR_SETUP}mock-layout`)).toContain("Tab!one");
  });
});
