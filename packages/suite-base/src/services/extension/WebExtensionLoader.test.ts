// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ExtensionBuilder from "@lichtblick/suite-base/testing/builders/ExtensionBuilder";

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
  mocks.install
    .mockReset()
    .mockResolvedValue(ExtensionBuilder.extensionInfo({ id: "test.example" }));
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
  // Given
  vi.stubGlobal("window", {});
  // When
  const loader = new WebExtensionLoader();
  // Then
  expect(loader.loadExtensionFromDirectory).toBeUndefined();
  expect(await loader.loadExtension("browser")).toEqual({ raw: "browser copy" });
});

it("requests read-only access when selecting an extension folder", async () => {
  // Given
  const disk = folder();
  const picker = vi.fn(async () => disk.directory);
  vi.stubGlobal("window", { showDirectoryPicker: picker });
  const loader = new WebExtensionLoader();
  // When
  await loader.loadExtensionFromDirectory!();
  // Then
  expect(picker).toHaveBeenCalledWith({ id: "lichtblick-extensions", mode: "read" });
});

it("restores saved handles in a new loader", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  await new WebExtensionLoader().loadExtensionFromDirectory!();
  // When
  const extensions = await new WebExtensionLoader().getExtensions();
  // Then
  expect(extensions).toEqual([expect.objectContaining({ id: "test.example", namespace: "local" })]);
});

it("reads updated extension source from disk", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  // When
  disk.source("updated code");
  const source = await loader.loadExtension("test.example");
  // Then
  expect(source).toEqual({ raw: "updated code" });
});

it("forgets the extension folder on uninstall", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  // When
  await loader.uninstallExtension("test.example");
  // Then
  expect(await loader.getExtensions()).toEqual([]);
});

it.each(["prompt", "denied"] as const)(
  "refuses code with %s permission while retaining removable metadata",
  async (permission) => {
    // Given
    const disk = folder();
    vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
    const loader = new WebExtensionLoader();
    await loader.loadExtensionFromDirectory!();
    disk.permission(permission);
    // When
    const extensions = await loader.getExtensions();
    const source = loader.loadExtension("test.example");
    // Then
    expect(extensions).toHaveLength(1);
    expect(loader.directoryErrors[0]).toContain("access is unavailable");
    await expect(source).rejects.toThrow();
  },
);

it("reconnects a folder after access is granted again", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  disk.permission("denied");
  await loader.getExtensions();
  // When
  disk.permission("granted");
  await loader.loadExtensionFromDirectory!();
  await loader.getExtensions();
  // Then
  expect(loader.directoryErrors).toEqual([]);
});

it("does not store a cancelled folder selection", async () => {
  // Given
  const picker = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
  vi.stubGlobal("window", { showDirectoryPicker: picker });
  const loader = new WebExtensionLoader();
  // When
  const selection = loader.loadExtensionFromDirectory!();
  // Then
  await expect(selection).rejects.toThrow("Cancelled");
  expect(await loader.getExtensions()).toEqual([]);
});

it("does not store a folder with malformed package metadata", async () => {
  // Given
  const disk = folder();
  disk.packageJson('{"name":3}');
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  // When
  const selection = loader.loadExtensionFromDirectory!();
  // Then
  await expect(selection).rejects.toThrow("Invalid extension");
  expect(await loader.getExtensions()).toEqual([]);
});

it("does not store an unbuilt extension folder", async () => {
  // Given
  const disk = folder();
  disk.missingSource();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  // When
  const selection = loader.loadExtensionFromDirectory!();
  // Then
  await expect(selection).rejects.toThrow("Missing file");
  expect(await loader.getExtensions()).toEqual([]);
});

it("uses an empty version when folder metadata omits it", async () => {
  // Given
  const disk = folder();
  disk.packageJson('{"name":"example","publisher":"test"}');
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  // When
  await loader.loadExtensionFromDirectory!();
  const info = await loader.getExtension("test.example");
  // Then
  expect(info?.version).toBe("");
});

it("rejects a folder that would shadow a browser installation", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  mocks.installed.mockResolvedValueOnce(ExtensionBuilder.extensionInfo({ id: "test.example" }));
  const loader = new WebExtensionLoader();
  // When
  const selection = loader.loadExtensionFromDirectory!();
  // Then
  await expect(selection).rejects.toThrow("Uninstall the browser copy");
  expect(mocks.records.size).toBe(0);
});

it("refuses source after a folder's identity changes", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  // When
  disk.packageJson('{"name":"other","publisher":"test"}');
  const source = loader.loadExtension("test.example");
  // Then
  await expect(source).rejects.toThrow("identity changed");
});

it("replaces the old identity when a renamed folder is selected again", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  disk.packageJson('{"name":"other","publisher":"test"}');
  // When
  await loader.loadExtensionFromDirectory!();
  // Then
  expect(await loader.getExtensions()).toEqual([expect.objectContaining({ id: "test.other" })]);
});

it("replaces a folder link with a normal package installation", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  // When
  await loader.installExtension({ foxeFileData: new Uint8Array() });
  // Then
  expect(await loader.loadExtension("test.example")).toEqual({ raw: "browser copy" });
});

it("replaces multiple folder links during concurrent package imports", async () => {
  // Given
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
    .mockResolvedValueOnce(ExtensionBuilder.extensionInfo({ id: "test.example" }))
    .mockResolvedValueOnce(ExtensionBuilder.extensionInfo({ id: "test.second" }));
  // When
  await Promise.all([
    loader.installExtension({ foxeFileData: new Uint8Array() }),
    loader.installExtension({ foxeFileData: new Uint8Array() }),
  ]);
  // Then
  expect(await loader.getExtensions()).toEqual([]);
});

it("keeps package metadata and source available when the folder database fails", async () => {
  // Given
  const info = ExtensionBuilder.extensionInfo({
    id: "test.example",
    displayName: "Package version",
  });
  mocks.listPackages.mockResolvedValue([info]);
  mocks.installed.mockResolvedValue(info);
  mocks.readDirectories.mockRejectedValue(new Error("Folder database closed"));
  const loader = new WebExtensionLoader();
  // When
  const extensions = await loader.getExtensions();
  // Then
  expect(extensions).toEqual([info]);
  expect(loader.directoryErrors).toEqual(["Folder database closed"]);
  expect(await loader.getExtension(info.id)).toEqual(info);
  expect(await loader.loadExtension(info.id)).toEqual({ raw: "browser copy" });
});

it("reconciles stale folder collisions and consistently selects the package", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  const info = ExtensionBuilder.extensionInfo({
    id: "test.example",
    displayName: "Package version",
  });
  mocks.listPackages.mockResolvedValue([info]);
  mocks.installed.mockResolvedValue(info);
  // When
  const extensions = await loader.getExtensions();
  // Then
  expect(extensions).toEqual([info]);
  expect(await loader.getExtension(info.id)).toEqual(info);
  expect(await loader.loadExtension(info.id)).toEqual({ raw: "browser copy" });
  expect(mocks.records.size).toBe(0);
});

it("discards a folder link when package installation wins the selection race", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  mocks.installed
    .mockResolvedValueOnce(undefined)
    .mockResolvedValue(ExtensionBuilder.extensionInfo({ id: "test.example" }));
  const loader = new WebExtensionLoader();
  // When
  const selection = loader.loadExtensionFromDirectory!();
  // Then
  await expect(selection).rejects.toThrow("Uninstall the browser copy");
  expect(mocks.records.size).toBe(0);
  expect(await loader.loadExtension("test.example")).toEqual({ raw: "browser copy" });
});

it("uninstalls both records of an existing collision", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  mocks.installed.mockResolvedValue(ExtensionBuilder.extensionInfo({ id: "test.example" }));
  // When
  await loader.uninstallExtension("test.example");
  // Then
  expect(mocks.records.size).toBe(0);
  expect(mocks.uninstall).toHaveBeenCalledWith("test.example");
});

it("keeps unrelated folders available when collision cleanup fails", async () => {
  // Given
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
  const info = ExtensionBuilder.extensionInfo({
    id: "test.example",
    displayName: "Package version",
  });
  mocks.listPackages.mockResolvedValue([info]);
  mocks.installed.mockImplementation(async (id: string) => (id === info.id ? info : undefined));
  mocks.deleteDirectory.mockRejectedValue(new Error("Cleanup failed"));
  // When
  const extensions = await loader.getExtensions();
  // Then
  expect(extensions).toEqual([info, expect.objectContaining({ id: "test.second" })]);
  expect(loader.directoryErrors).toContain("Cleanup failed");
});

it("returns the installed package when folder cleanup fails", async () => {
  // Given
  mocks.deleteDirectory.mockRejectedValue(new Error("Cleanup failed"));
  const loader = new WebExtensionLoader();
  // When
  const info = await loader.installExtension({ foxeFileData: new Uint8Array() });
  // Then
  expect(info.id).toBe("test.example");
  expect(loader.directoryErrors).toContain("Cleanup failed");
});

it("does not remove a package when forgetting its folder fails", async () => {
  // Given
  mocks.installed.mockResolvedValue(ExtensionBuilder.extensionInfo({ id: "test.example" }));
  mocks.deleteDirectory.mockRejectedValue(new Error("Cleanup failed"));
  const loader = new WebExtensionLoader();
  // When
  const uninstall = loader.uninstallExtension("test.example");
  // Then
  await expect(uninstall).rejects.toThrow("Cleanup failed");
  expect(mocks.uninstall).not.toHaveBeenCalled();
});

it("looks up a single folder without clearing other folder errors", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  const loader = new WebExtensionLoader();
  await loader.loadExtensionFromDirectory!();
  loader.directoryErrors = ["Other folder unavailable"];
  mocks.readDirectories.mockClear();
  // When
  const info = await loader.getExtension("test.example");
  // Then
  expect(info).toEqual(expect.objectContaining({ id: "test.example" }));
  expect(mocks.readDirectories).not.toHaveBeenCalled();
  expect(loader.directoryErrors).toEqual(["Other folder unavailable"]);
});

it("reports both a package conflict and a failed folder cleanup", async () => {
  // Given
  const disk = folder();
  vi.stubGlobal("window", { showDirectoryPicker: async () => disk.directory });
  mocks.installed
    .mockResolvedValueOnce(undefined)
    .mockResolvedValue(ExtensionBuilder.extensionInfo({ id: "test.example" }));
  mocks.deleteDirectory.mockRejectedValue(new Error("Database closed"));
  const loader = new WebExtensionLoader();
  // When
  const selection = loader.loadExtensionFromDirectory!();
  // Then
  await expect(selection).rejects.toThrow(/browser copy.*Database closed/);
});

it("removes package metadata when its archive is already missing", async () => {
  // Given
  const info = ExtensionBuilder.extensionInfo({
    id: "test.example",
    displayName: "Orphaned package",
  });
  mocks.listPackages.mockResolvedValue([info]);
  mocks.installed.mockResolvedValue(undefined);
  mocks.uninstall.mockImplementation(async () => {
    mocks.listPackages.mockResolvedValue([]);
  });
  const loader = new WebExtensionLoader();
  // When
  await loader.uninstallExtension(info.id);
  // Then
  expect(await loader.getExtensions()).toEqual([]);
});
