// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { EventEmitter } from "events";

const mockNativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false });
const mockWindows: (EventEmitter & { setBackgroundColor: jest.Mock })[] = [];

jest.mock("electron", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter: Emitter } = require("events") as typeof import("events");
  class MockBrowserWindow extends Emitter {
    public webContents = { id: mockWindows.length, on: jest.fn(),
      once: jest.fn(),
      setWindowOpenHandler: jest.fn(),
    };
    public setBackgroundColor = jest.fn();
    public setTitleBarOverlay = jest.fn();
    public constructor() {
      super();
      mockWindows.push(this);
    }
  }
  return {
    app: { getAppPath: () => "/app", name: "Lichtblick" },
    BrowserWindow: MockBrowserWindow,
    Menu: { buildFromTemplate: jest.fn(() => ({})), getApplicationMenu: jest.fn() },
    MenuItem: jest.fn(),
    nativeTheme: mockNativeTheme,
    shell: { openExternal: jest.fn() },
    systemPreferences: { getUserDefault: jest.fn() },
  };
});
jest.mock("@lichtblick/log", () => ({ getLogger: () => ({ info: jest.fn() }) }));
jest.mock("@lichtblick/suite-base/src/i18n", () => ({
  sharedI18nObject: { on: jest.fn(), t: (key: string) => key },
}));
jest.mock("@lichtblick/theme", () => ({
  palette: {
    light: { background: { default: "#fff" }, appBar: {} },
    dark: { background: { default: "#000" }, appBar: {} },
  },
}));
jest.mock("../common/webpackDefines", () => ({ LICHTBLICK_PRODUCT_NAME: "Lichtblick" }));
jest.mock("./StudioAppUpdater", () => ({
  Instance: () => ({ checkNow: jest.fn(), canCheckForUpdates: () => false }),
}));
jest.mock("./telemetry", () => ({
  getTelemetrySettings: () => ({ crashReportingEnabled: false, telemetryEnabled: false }),
}));
jest.mock("./getDevModeIcon", () => () => undefined);

(global as unknown as { MAIN_WINDOW_WEBPACK_ENTRY: string }).MAIN_WINDOW_WEBPACK_ENTRY = "file://";

describe("StudioWindow theme listener", () => {
  it("stops updating a window after it is closed", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const StudioWindow = (require("./StudioWindow") as typeof import("./StudioWindow")).default;
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
