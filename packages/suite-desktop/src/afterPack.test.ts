// SPDX-License-Identifier: MPL-2.0

import fs from "fs/promises";
import os from "os";
import path from "path";

import { download, listAsarFiles } from "./afterPack";

describe("download", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries network errors and 5xx responses, then returns the body", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("zip"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(download("https://example.com/a.zip", 0)).resolves.toEqual(
      new TextEncoder().encode("zip"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after 3 tries, and at once on a 4xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(download("https://example.com/a.zip", 0)).rejects.toThrow("failed: 502");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear().mockResolvedValue(new Response("", { status: 404 }));
    await expect(download("https://example.com/a.zip", 0)).rejects.toThrow("failed: 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

type AsarEntry = { files?: Record<string, AsarEntry>; size?: number; offset?: string };

/** Writes the header of an asar archive (as @electron/asar lays it out) with no file contents. */
async function writeAsarHeader(file: string, header: AsarEntry): Promise<void> {
  const json = Buffer.from(JSON.stringify(header) ?? "");
  const sizes = Buffer.alloc(16);
  sizes.writeUInt32LE(4, 0);
  sizes.writeUInt32LE(json.length + 8, 4);
  sizes.writeUInt32LE(json.length + 4, 8);
  sizes.writeUInt32LE(json.length, 12);
  await fs.writeFile(file, Buffer.concat([sizes, json]));
}

describe("listAsarFiles", () => {
  it("lists nested files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "asar-"));
    const asar = path.join(dir, "app.asar");
    await writeAsarHeader(asar, {
      files: {
        "main.js": { size: 1, offset: "0" },
        renderer: {
          files: { "index.js": { size: 1, offset: "1" }, "index.js.map": { size: 1, offset: "2" } },
        },
      },
    });

    await expect(listAsarFiles(asar)).resolves.toEqual([
      "main.js",
      "renderer/index.js",
      "renderer/index.js.map",
    ]);
    await fs.rm(dir, { recursive: true });
  });
});
