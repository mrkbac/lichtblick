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

const mockOpenExternal = vi.hoisted(() => vi.fn());

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
    shell: { openExternal: mockOpenExternal },
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
    light: { background: { default: "#fff" }, appBar: { main: "#111" } },
    dark: { background: { default: "#000" }, appBar: { main: "#222" } },
  },
}));
vi.mock("../common/webpackDefines", () => ({ LICHTBLICK_PRODUCT_NAME: "Lichtblick" }));
vi.mock("./StudioAppUpdater", () => ({
  default: { Instance: () => ({ checkNow: vi.fn(), canCheckForUpdates: () => false }) },
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

describe("openExternalUrl", () => {
  it("opens only web and mailto URLs", async () => {
    const { openExternalUrl } = await import("./StudioWindow");
    for (const url of ["https://example.org", "http://localhost:8080/", "mailto:foo@example.org"]) {
      openExternalUrl(url);
    }
    for (const url of ["file:///etc/passwd", "smb://example/share", "javascript:alert(1)", "foo"]) {
      openExternalUrl(url);
    }
    expect(mockOpenExternal.mock.calls.map(([url]) => url)).toEqual([
      "https://example.org",
      "http://localhost:8080/",
      "mailto:foo@example.org",
    ]);
  });
});

describe("isAppUrl", () => {
  it("allows only the packaged renderer page among file:// URLs", async () => {
    const { isAppUrl } = await import("./StudioWindow");
    const app = "file:///app/resources/app.asar/.webpack/renderer/index.html";
    expect(isAppUrl(`${app}?ds=foo#bar`, app)).toBe(true);
    expect(isAppUrl("file:///tmp/example.html", app)).toBe(false);
    expect(isAppUrl("file:///app/resources/app.asar/.webpack/renderer/other.html", app)).toBe(
      false,
    );
    expect(isAppUrl("https://example.org/", app)).toBe(false);
    expect(isAppUrl("not a url", app)).toBe(false);
  });

  it("compares origins for the dev server", async () => {
    const { isAppUrl } = await import("./StudioWindow");
    const app = "http://localhost:8080/index.html";
    expect(isAppUrl("http://localhost:8080/foo", app)).toBe(true);
    expect(isAppUrl("http://localhost:9090/", app)).toBe(false);
    expect(isAppUrl("file:///tmp/example.html", app)).toBe(false);
  });
});
