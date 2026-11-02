// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { EventEmitter } from "events";
import type { Mock } from "vitest";

const { mockNativeTheme, mockWindows } = await vi.hoisted(async () => {
  const { EventEmitter: Emitter } = await import("events");
  return {
    mockNativeTheme: Object.assign(new Emitter(), { shouldUseDarkColors: false }),
    mockWindows: [] as (EventEmitter & { setBackgroundColor: Mock })[],
  };
});

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("events");
  class MockBrowserWindow extends Emitter {
    public webContents = {
      id: mockWindows.length,
      on: vi.fn(),
      once: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    public setBackgroundColor = vi.fn();
    public setTitleBarOverlay = vi.fn();
    public constructor() {
      super();
      mockWindows.push(this);
    }
  }
  return {
    app: { getAppPath: () => "/app", name: "Lichtblick" },
    BrowserWindow: MockBrowserWindow,
    Menu: { buildFromTemplate: vi.fn(() => ({})), getApplicationMenu: vi.fn() },
    MenuItem: vi.fn(),
    nativeTheme: mockNativeTheme,
    shell: { openExternal: vi.fn() },
    systemPreferences: { getUserDefault: vi.fn() },
  };
});
vi.mock("@lichtblick/log", () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { default: { getLogger: () => logger }, getLogger: () => logger };
});
vi.mock("@lichtblick/suite-base/src/i18n", () => ({
  sharedI18nObject: { on: vi.fn(), t: (key: string) => key },
}));
vi.mock("@lichtblick/theme", () => ({
  palette: {
    light: { background: { default: "#fff" }, appBar: {} },
    dark: { background: { default: "#000" }, appBar: {} },
  },
}));
vi.mock("../common/webpackDefines", () => ({ LICHTBLICK_PRODUCT_NAME: "Lichtblick" }));
vi.mock("./StudioAppUpdater", () => ({
  default: { Instance: () => ({ checkNow: vi.fn(), canCheckForUpdates: () => false }) },
}));
vi.mock("./telemetry", () => ({
  getTelemetrySettings: () => ({ crashReportingEnabled: false, telemetryEnabled: false }),
}));
vi.mock("./getDevModeIcon", () => ({ default: () => undefined }));

(global as unknown as { MAIN_WINDOW_WEBPACK_ENTRY: string }).MAIN_WINDOW_WEBPACK_ENTRY = "file://";

describe("StudioWindow theme listener", () => {
  it("stops updating a window after it is closed", async () => {
    const { default: StudioWindow } = await import("./StudioWindow");
    new StudioWindow();
    const win = mockWindows[0]!;

    mockNativeTheme.emit("updated");
    expect(win.setBackgroundColor).toHaveBeenCalledTimes(1);

    win.emit("closed");
    mockNativeTheme.emit("updated");
    expect(win.setBackgroundColor).toHaveBeenCalledTimes(1);
    expect(mockNativeTheme.listenerCount("updated")).toBe(0);
  });
});
