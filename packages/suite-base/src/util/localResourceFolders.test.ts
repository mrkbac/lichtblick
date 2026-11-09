/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LocalResourceFolders } from "./localResourceFolders";

type Tree = { [name: string]: string | Tree };
function directory(name: string, tree: Tree): FileSystemDirectoryHandle {
  const entries = Object.entries(tree).map(([key, value]) =>
    typeof value === "string"
      ? {
          kind: "file",
          name: key,
          getFile: async () => ({
            text: async () => value,
            arrayBuffer: async () => new TextEncoder().encode(value).buffer,
            type: "",
          }),
        }
      : directory(key, value),
  );
  const handle = {
    kind: "directory",
    name,
    getFileHandle: vi.fn(async (key: string) => {
      const found = entries.find((entry) => entry.name === key && entry.kind === "file");
      if (!found) {
        throw new DOMException("Missing file", "NotFoundError");
      }
      return found;
    }),
    getDirectoryHandle: vi.fn(async (key: string) => {
      const found = entries.find((entry) => entry.name === key && entry.kind === "directory");
      if (!found) {
        throw new DOMException("Missing directory", "NotFoundError");
      }
      return found;
    }),
    async *values() {
      yield* entries;
    },
    isSameEntry: async (other: FileSystemDirectoryHandle): Promise<boolean> =>
      other === (handle as unknown as FileSystemDirectoryHandle),
  };
  return handle as unknown as FileSystemDirectoryHandle;
}
const manifest = "<package><name>robot</name></package>";

describe("LocalResourceFolders", () => {
  it("discovers package names from manifests and returns a canonical local URI", async () => {
    const resources = new LocalResourceFolders();
    await resources.add(
      directory("workspace", {
        src: {
          folder_not_package_name: {
            "package.xml": manifest,
            meshes: { "wheel space.stl": "mesh" },
          },
        },
      }),
    );
    const asset = await resources.fetchAsset("package://robot/meshes/wheel%20space.stl");
    expect(Array.from(asset!.data)).toEqual(Array.from(new TextEncoder().encode("mesh")));
    expect(asset?.uri).toMatch(
      /^local-asset:\/\/[^/]+\/src\/folder_not_package_name\/meshes\/wheel%20space.stl$/,
    );
    expect(await resources.fetchAsset(asset!.uri)).toEqual(asset);
    expect(await resources.fetchAsset("package://missing/a.stl")).toBeUndefined();
  });

  it("supports a package at the selected root and folders without packages", async () => {
    const resources = new LocalResourceFolders();
    await resources.add(directory("root", { "package.xml": manifest, "a.stl": "root mesh" }));
    expect(Array.from((await resources.fetchAsset("package://robot/a.stl"))!.data)).toEqual(
      Array.from(new TextEncoder().encode("root mesh")),
    );
    await resources.add(directory("assets", { "a.stl": "plain" }));
    const id = resources.getSnapshot().folders[1]!.id;
    expect(Array.from((await resources.fetchAsset(`local-asset://${id}/a.stl`))!.data)).toEqual(
      Array.from(new TextEncoder().encode("plain")),
    );
  });

  it("rejects duplicate packages instead of choosing a folder", async () => {
    const resources = new LocalResourceFolders();
    await resources.add(directory("a", { "package.xml": manifest }));
    await resources.add(directory("b", { "package.xml": manifest }));
    await expect(resources.fetchAsset("package://robot/a.stl")).rejects.toThrow(
      "multiple selected locations",
    );
  });

  it.each([
    "../secret",
    "%2e%2e/secret",
    "a/%2Fsecret",
    "a/%5csecret",
    "a/%00",
    "/secret",
    "a/./b",
  ])("rejects unsafe paths: %s", async (path) => {
    const resources = new LocalResourceFolders();
    await expect(resources.fetchAsset(`package://robot/${path}`)).rejects.toThrow(
      "inside its folder",
    );
  });

  it("keeps the previous index when a scan fails and reports permission failures", async () => {
    const resources = new LocalResourceFolders();
    const handle = directory("a", { "package.xml": manifest, "a.stl": "mesh" });
    await resources.add(handle);
    const snapshot = resources.getSnapshot();
    vi.spyOn(handle, "getFileHandle").mockRejectedValue(
      new DOMException("Access revoked", "NotAllowedError"),
    );
    await expect(resources.add(handle)).rejects.toThrow("Access revoked");
    expect(resources.getSnapshot()).toBe(snapshot);
    await expect(resources.fetchAsset("package://robot/a.stl")).rejects.toThrow("Access revoked");
  });

  it("rejects malformed manifests atomically", async () => {
    const resources = new LocalResourceFolders();
    await expect(
      resources.add(directory("a", { "package.xml": "<package><name>bad" })),
    ).rejects.toThrow("Invalid ROS package.xml");
    expect(resources.getSnapshot().folders).toEqual([]);
  });

  it("refreshes the same grant, notifies subscribers, and revokes removed URLs", async () => {
    const resources = new LocalResourceFolders();
    const handle = directory("a", { "a.stl": "mesh" });
    const listener = vi.fn();
    const unsubscribe = resources.subscribe(listener);
    await resources.add(handle);
    const id = resources.getSnapshot().folders[0]!.id;
    await resources.add(handle);
    expect(resources.getSnapshot().folders).toHaveLength(1);
    expect(resources.getSnapshot().folders[0]!.id).toBe(id);
    resources.remove(id);
    expect(listener).toHaveBeenCalledTimes(3);
    await expect(resources.fetchAsset(`local-asset://${id}/a.stl`)).rejects.toThrow("unavailable");
    unsubscribe();
  });

  it("respects aborted reads", async () => {
    const resources = new LocalResourceFolders();
    await resources.add(directory("a", { "package.xml": manifest, "a.stl": "mesh" }));
    await expect(
      resources.fetchAsset("package://robot/a.stl", { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
  });
});
