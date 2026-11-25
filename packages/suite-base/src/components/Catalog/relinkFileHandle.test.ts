// SPDX-License-Identifier: MPL-2.0

import { relinkFileHandle, saveLastFolder } from "./indexFolder";

// Handles with methods can't be structured-cloned into fake-indexeddb
vi.mock("@lichtblick/suite-base/util/idbKeyValueStore", () => ({
  createKeyValueStore: () => {
    const map = new Map<unknown, unknown>();
    return {
      get: async (key: unknown) => map.get(key),
      set: async (key: unknown, value: unknown) => void map.set(key, value),
      readwrite: async () => ({ getAll: async () => [...map.values()] }),
    };
  },
}));

const never = async <T>(): Promise<T> => await new Promise<T>(() => {});

function fileHandle(
  name: string,
  { hangs = false }: { hangs?: boolean } = {},
): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    queryPermission: hangs ? never : async () => "granted",
    getFile: hangs ? never : async () => new File([], name),
  } as unknown as FileSystemFileHandle;
}

function folder(entries: FileSystemHandle[], permission = "granted"): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    queryPermission: async () => permission,
    async *values() {
      yield* entries;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("relinkFileHandle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a handle that still reads", async () => {
    const handle = fileHandle("a.mcap");
    await expect(relinkFileHandle(handle)).resolves.toBe(handle);
  });

  it("finds a hanging handle's file by name in a granted catalog folder", async () => {
    const moved = fileHandle("a.mcap");
    await saveLastFolder(folder([fileHandle("a.mcap")], "prompt"), "denied");
    await saveLastFolder(folder([folder([moved]), fileHandle("b.mcap")]), "last");

    const result = relinkFileHandle(fileHandle("a.mcap", { hangs: true }));
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe(moved);
  });

  it("says how to relink when no folder has the file", async () => {
    const result = relinkFileHandle(fileHandle("gone.mcap", { hangs: true })).catch(
      (err: unknown) => err,
    );
    await vi.runAllTimersAsync();
    expect(String(await result)).toMatch(/Open its folder in the catalog/);
  });
});
