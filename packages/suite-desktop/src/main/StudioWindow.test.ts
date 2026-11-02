// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";
import { EventEmitter } from "events";

const mockNativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false });
const mockWindows: (EventEmitter & { setBackgroundColor: Mock })[] = [];

vi.mock("electron", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter: Emitter } = require("events") as typeof import("events");
  class MockBrowserWindow extends Emitter {
    public webContents = { id: mockWindows.length, on: vi.fn(),
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
vi.mock("@lichtblick/log", () => ({ getLogger: () => ({ info: vi.fn() }) }));
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
  Instance: () => ({ checkNow: vi.fn(), canCheckForUpdates: () => false }),
}));
vi.mock("./telemetry", () => ({
  getTelemetrySettings: () => ({ crashReportingEnabled: false, telemetryEnabled: false }),
}));
vi.mock("./getDevModeIcon", () => () => undefined);

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
