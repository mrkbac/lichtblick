// SPDX-License-Identifier: MPL-2.0

import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";

import LocalFileStorage from "./LocalFileStorage";

const userData = vi.hoisted(() => ({ dir: "" }));
vi.mock("electron", () => ({
  ipcRenderer: { invoke: async () => userData.dir },
}));

describe("LocalFileStorage", () => {
  beforeEach(async () => {
    userData.dir = await mkdtemp(path.join(os.tmpdir(), "storage-"));
  });
  afterEach(async () => {
    await rm(userData.dir, { recursive: true, force: true });
  });

  it("stores plain keys under the datastore", async () => {
    const storage = new LocalFileStorage();
    await storage.put("settings", "settings.json", "{}");
    await expect(storage.get("settings", "settings.json")).resolves.toBe("{}");
    await expect(
      readFile(path.join(userData.dir, "studio-datastores", "settings", "settings.json"), "utf8"),
    ).resolves.toBe("{}");
  });

  it.each(["../../foo", "..", ".foo", "foo/bar", "foo\\bar", "a..b", ""])(
    "rejects key %j",
    async (key) => {
      await expect(new LocalFileStorage().put("settings", key, "x")).rejects.toThrow(
        "invalid characters",
      );
    },
  );

  it.each(["../foo", "foo/bar", "Foo", "-", ""])("rejects datastore %j", async (datastore) => {
    await expect(new LocalFileStorage().get(datastore, "foo")).rejects.toThrow(
      "invalid characters",
    );
  });
});
