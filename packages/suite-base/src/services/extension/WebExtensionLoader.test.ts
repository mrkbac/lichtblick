// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { WebExtensionLoader } from "./WebExtensionLoader";

const mocks = vi.hoisted(() => ({
  records: new Map<IDBValidKey, unknown>(),
  installed: vi.fn(),
  uninstall: vi.fn(),
  install: vi.fn(),
  listPackages: vi.fn(),
  readDirectories: vi.fn(),
  deleteDirectory: vi.fn(),
}));
vi.mock("idb", () => {
  const store = {
    getAll: async () => await mocks.readDirectories(),
    get: async (_name: string, key: IDBValidKey) => mocks.records.get(key),
    delete: async (_name: string, key: IDBValidKey) => {
      await mocks.deleteDirectory(key);
    },
  };
  return {
    openDB: async () => ({
      ...store,
      transaction: () => ({
        store: {
          put: async (value: unknown, key: IDBValidKey) => {
            mocks.records.set(key, value);
          },
          delete: async (key: IDBValidKey) => {
            mocks.records.delete(key);
          },
        },
        done: Promise.resolve(),
      }),
    }),
  };
});
vi.mock("@lichtblick/suite-base/services/extension/IdbExtensionLoader", () => ({
  IdbExtensionLoader: class {
    public namespace = "local";
    public type = "browser";
    public async getExtensions() {
      return await mocks.listPackages();
    }
    public async getExtension(id: string) {
      return await mocks.installed(id);
    }
    public async uninstallExtension(id: string) {
      await mocks.uninstall(id);
    }
    public async installExtension(data: { foxeFileData: Uint8Array }) {
      return await mocks.install(data);
    }
    public async loadExtension() {
      return { raw: "browser copy" };
    }
  },
}));

function folder() {
  let source = "module.exports = { activate() {} }";
  let permission: PermissionState = "granted";
  let packageJson = JSON.stringify({ name: "example", publisher: "test", version: "1.0.0" });
  let missingSource = false;
  const getFileHandle = vi.fn(async (name: string) => {
    if (
      name === "README.md" ||
      name === "CHANGELOG.md" ||
      (missingSource && name === "extension.js")
    ) {
      throw new DOMException("Missing file", "NotFoundError");
    }
    return {
      getFile: async () => ({ text: async () => (name === "package.json" ? packageJson : source) }),
    };
  });
  const directory = {
    getFileHandle,
    isSameEntry: async (other: FileSystemHandle) => other === directory,
    getDirectoryHandle: vi.fn(async () => ({ getFileHandle })),
    queryPermission: vi.fn(async () => permission),
  } as unknown as FileSystemDirectoryHandle;
  return {
    directory,
    source: (value: string) => {
      source = value;
    },
    permission: (value: PermissionState) => {
      permission = value;
    },
    packageJson: (value: string) => {
      packageJson = value;
    },
    missingSource: () => {
      missingSource = true;
    },
  };
}

beforeEach(() => {
  mocks.records.clear();
  mocks.installed.mockReset();
  mocks.uninstall.mockReset();
  mocks.install.mockReset().mockResolvedValue({ id: "test.example" });
  mocks.listPackages.mockReset().mockResolvedValue([]);
  mocks.readDirectories.mockReset().mockImplementation(async () => [...mocks.records.values()]);
  mocks.deleteDirectory.mockReset().mockImplementation(async (key: IDBValidKey) => {
    mocks.records.delete(key);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("keeps browser installation available when directory selection is unsupported", async () => {
  vi.stubGlobal("window", {});
  const loader = new WebExtensionLoader();
  expect(loader.loadExtensionFromDirectory).toBeUndefined();
  expect(await loader.loadExtension("browser")).toEqual({ raw: "browser copy" });
});

it("selects read-only access, persists handles, and reads updated code on reload", async () => {
  const disk = folder();
  const picker = vi.fn(async () => disk.directory);
  vi.stubGlobal("window", { showDirectoryPicker: picker });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  expect(picker).toHaveBeenCalledWith({ id: "lichtblick-extensions", mode: "read" });
  const restored = new WebExtensionLoader();
  expect(await restored.getExtensions()).toEqual([
    expect.objectContaining({ id: "test.example", namespace: "local" }),
  ]);
  disk.source("updated code");
  expect(await restored.loadExtension("test.example")).toEqual({ raw: "updated code" });
  await restored.uninstallExtension("test.example");
  expect(await restored.getExtensions()).toEqual([]);
  expect(mocks.uninstall).not.toHaveBeenCalled();
});

it.each(["prompt", "denied"] as const)(
  "retains a removable entry but refuses code with %s permission",
  async (permission) => {
    const disk = folder();
    vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
    const loader = new WebExtensionLoader();
    await loader.loadExtensionFromDirectory!();
    disk.permission(permission);
    expect(await loader.getExtensions()).toHaveLength(1);
    expect(loader.directoryErrors[0]).toContain("access is unavailable");
    await expect(loader.loadExtension("test.example")).rejects.toThrow();
    disk.permission("granted");
    await loader.loadExtensionFromDirectory!();
    await loader.getExtensions();
    expect(loader.directoryErrors).toEqual([]);
  },
);

it("does not store cancelled, malformed, or unbuilt folders", async () => {
  const disk = folder();
  const picker = vi.fn(async () => disk.directory);
  vi.stubGlobal("window", { showDirectoryPicker: picker });
  const loader = new WebExtensionLoader();
  picker.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
  await expect(loader.loadExtensionFromDirectory!()).rejects.toThrow("Cancelled");
  disk.packageJson('{"name":3}');
  await expect(loader.loadExtensionFromDirectory!()).rejects.toThrow("Invalid extension");
  disk.packageJson('{"name":"example","publisher":"test"}');
  disk.missingSource();
  await expect(loader.loadExtensionFromDirectory!()).rejects.toThrow("Missing file");
  expect(await loader.getExtensions()).toEqual([]);
});

it("rejects identity changes and avoids shadowing browser installations", async () => {
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  mocks.installed.mockResolvedValueOnce({ id: "test.example" });
  await expect(loader.loadExtensionFromDirectory!()).rejects.toThrow("Uninstall the browser copy");
  await loader.loadExtensionFromDirectory!();
  disk.packageJson('{"name":"other","publisher":"test"}');
  await expect(loader.loadExtension("test.example")).rejects.toThrow("identity changed");
  await loader.getExtensions();
  expect(loader.directoryErrors[0]).toContain("identity changed");
  await loader.loadExtensionFromDirectory!();
  expect(await loader.getExtensions()).toEqual([expect.objectContaining({ id: "test.other" })]);
});

it("replaces a folder link with a normal package installation", async () => {
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  await loader.installExtension({ foxeFileData: new Uint8Array() });
  expect(await loader.loadExtension("test.example")).toEqual({ raw: "browser copy" });
});

it("replaces multiple folder links during concurrent package imports", async () => {
  const first = folder();
  const second = folder();
  second.packageJson('{"name":"second","publisher":"test"}');
  const picker = vi
    .fn()
    .mockResolvedValueOnce(first.directory)
    .mockResolvedValueOnce(second.directory);
  vi.stubGlobal("window", { showDirectoryPicker: picker });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  await loader.loadExtensionFromDirectory!();
  mocks.install
    .mockResolvedValueOnce({ id: "test.example" })
    .mockResolvedValueOnce({ id: "test.second" });
  await Promise.all([
    loader.installExtension({ foxeFileData: new Uint8Array() }),
    loader.installExtension({ foxeFileData: new Uint8Array() }),
  ]);
  expect(await loader.getExtensions()).toEqual([]);
});

it("keeps package metadata and source available when the folder database fails", async () => {
  const info = { id: "test.example", displayName: "Package version" };
  mocks.listPackages.mockResolvedValue([info]);
  mocks.installed.mockResolvedValue(info);
  mocks.readDirectories.mockRejectedValue(new Error("Folder database closed"));
  const loader = new WebExtensionLoader();
  expect(await loader.getExtensions()).toEqual([info]);
  expect(loader.directoryErrors).toEqual(["Folder database closed"]);
  expect(await loader.getExtension(info.id)).toEqual(info);
  expect(await loader.loadExtension(info.id)).toEqual({ raw: "browser copy" });
});

it("reconciles stale folder collisions and consistently selects package metadata and source", async () => {
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  const info = { id: "test.example", displayName: "Package version" };
  mocks.listPackages.mockResolvedValue([info]);
  mocks.installed.mockResolvedValue(info);
  expect(await loader.getExtension(info.id)).toEqual(info);
  expect(await loader.loadExtension(info.id)).toEqual({ raw: "browser copy" });
  expect(await loader.getExtensions()).toEqual([info]);
  expect(mocks.records.size).toBe(0);
});

it("discards a folder link when a package installation wins the selection race", async () => {
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  mocks.installed.mockResolvedValueOnce(undefined).mockResolvedValue({ id: "test.example" });
  const loader = new WebExtensionLoader();
  await expect(loader.loadExtensionFromDirectory!()).rejects.toThrow("Uninstall the browser copy");
  expect(mocks.records.size).toBe(0);
  expect(await loader.loadExtension("test.example")).toEqual({ raw: "browser copy" });
});

it("uninstalls both records of an existing collision", async () => {
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  mocks.installed.mockResolvedValue({ id: "test.example" });
  await loader.uninstallExtension("test.example");
  expect(mocks.records.size).toBe(0);
  expect(mocks.uninstall).toHaveBeenCalledWith("test.example");
});

it("keeps unrelated folders available when collision cleanup fails", async () => {
  const first = folder();
  const second = folder();
  second.packageJson('{"name":"second","publisher":"test"}');
  const picker = vi
    .fn()
    .mockResolvedValueOnce(first.directory)
    .mockResolvedValueOnce(second.directory);
  vi.stubGlobal("window", { showDirectoryPicker: picker });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  await loader.loadExtensionFromDirectory!();
  const info = { id: "test.example", displayName: "Package version" };
  mocks.listPackages.mockResolvedValue([info]);
  mocks.installed.mockImplementation(async (id: string) => (id === info.id ? info : undefined));
  mocks.deleteDirectory.mockRejectedValue(new Error("Cleanup failed"));
  expect(await loader.getExtensions()).toEqual([
    info,
    expect.objectContaining({ id: "test.second" }),
  ]);
  expect(loader.directoryErrors).toContain("Cleanup failed");
});

it("returns the installed package when folder cleanup fails", async () => {
  mocks.deleteDirectory.mockRejectedValue(new Error("Cleanup failed"));
  const loader = new WebExtensionLoader();
  expect(await loader.installExtension({ foxeFileData: new Uint8Array() })).toEqual({
    id: "test.example",
  });
  expect(loader.directoryErrors).toContain("Cleanup failed");
});

it("does not remove a package when forgetting its folder fails", async () => {
  mocks.installed.mockResolvedValue({ id: "test.example" });
  mocks.deleteDirectory.mockRejectedValue(new Error("Cleanup failed"));
  const loader = new WebExtensionLoader();
  await expect(loader.uninstallExtension("test.example")).rejects.toThrow("Cleanup failed");
  expect(mocks.uninstall).not.toHaveBeenCalled();
});

it("looks up a single folder without clearing other folder errors", async () => {
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  loader.directoryErrors = ["Other folder unavailable"];
  mocks.readDirectories.mockClear();
  expect(await loader.getExtension("test.example")).toEqual(
    expect.objectContaining({ id: "test.example" }),
  );
  expect(mocks.readDirectories).not.toHaveBeenCalled();
  expect(loader.directoryErrors).toEqual(["Other folder unavailable"]);
});
