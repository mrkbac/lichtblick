// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import fs, { Stats } from "fs";
import os from "os";
import nodePath from "path";
import type { Mock } from "vitest";

import { BasicBuilder } from "@lichtblick/test-builders";

import { getFilesFromDirectory, isPathToDirectory, resolveSourcePaths } from "./resolveSourcePaths";

type FileStructure = {
  name: string;
  content: string;
  extension: string;
};

function genericString(): string {
  return BasicBuilder.string({ length: 6, charset: "alphanumeric" });
}

function buildFile(file: Partial<FileStructure> = {}): Pick<FileStructure, "name" | "content"> {
  return {
    name: `${genericString()}.${file.extension ?? "mcap"}`,
    content: genericString(),
    ...file,
  };
}

function buildPath(): string {
  return `${genericString()}/${genericString()}`;
}

type Tree = { [name: string]: string | Tree };

let tmpRoot = "";

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), "resolveSourcePaths-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Writes `tree` below a fresh temp dir. Keys are relative paths; string values are file contents. */
function writeTree(tree: Tree, dir = tmpRoot): void {
  for (const [name, value] of Object.entries(tree)) {
    const target = nodePath.join(dir, name);
    if (typeof value === "string") {
      fs.mkdirSync(nodePath.dirname(target), { recursive: true });
      fs.writeFileSync(target, value);
    } else {
      fs.mkdirSync(target, { recursive: true });
      writeTree(value, target);
    }
  }
}

function inTmp(relativePath: string): string {
  return nodePath.join(tmpRoot, relativePath);
}

function setup() {
  const path = buildPath();
  const file1 = buildFile({ extension: "txt" });
  const file2 = buildFile({ extension: "txt" });
  const file3 = buildFile({ extension: "mcap" });
  const files = { file1, file2, file3 };
  writeTree({
    [path]: {
      [file1.name]: file1.content,
      [file2.name]: file2.content,
      [file3.name]: file3.content,
    },
  });

  return { path: inTmp(path), files };
}

describe("getFilesFromDirectory", () => {
  it("should return only the .mcap files from the directory", () => {
    const { path, files } = setup();
    const mcapFiles = Object.values(files)
      .filter((file) => file.name.endsWith(".mcap"))
      .map((file) => file.name);

    const result = getFilesFromDirectory(path);

    expect(result).toEqual(mcapFiles);
  });

  it("should a return a empty array because the directory has no supported files", () => {
    writeTree({ [genericString()]: { [buildFile({ extension: "txt" }).name]: "" } });

    const result = getFilesFromDirectory(inTmp(buildPath()));

    expect(result).toEqual([]);
    expect(console.error).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("ENOENT: no such file or directory"),
      }),
    );
    (console.error as Mock).mockClear();
  });

  it("should return an empty array when an error occurs in fs.readdirSync", () => {
    const result = getFilesFromDirectory("");

    expect(result).toEqual([]);
    expect(console.error).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "ENOENT: no such file or directory, scandir ''",
      }),
    );
    (console.error as Mock).mockClear();
  });
});

describe("isPathToDirectory", () => {
  it("should return false cause there's more than one path", () => {
    const path1 = buildPath();
    const path2 = buildPath();
    writeTree({ [path1]: {}, [path2]: {} });

    const result = isPathToDirectory([inTmp(path1), inTmp(path2)]);

    expect(result).toBe(false);
  });

  it("should return true because the path passed is a path to a directory", () => {
    const path1 = buildPath();
    writeTree({ [path1]: {} });

    const result = isPathToDirectory([inTmp(path1)]);

    expect(result).toBe(true);
  });

  it("should return false when a error occurs", () => {
    const paths = [""];

    const result = isPathToDirectory(paths);

    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "ENOENT: no such file or directory, stat ''",
      }),
    );
    (console.error as Mock).mockClear();
  });
});

describe("resolveSourcePaths", () => {
  vi.spyOn(os, "homedir").mockReturnValue(buildPath());

  it("should return an empty array because there was no source parameter provided", () => {
    const mockSourceParameter = undefined;

    const result = resolveSourcePaths(mockSourceParameter);

    expect(result).toEqual([]);
  });

  it("should return an array with a single path to a file", () => {
    const path = buildPath();
    const file = buildFile({ extension: "mcap" });
    const sourceParameter = `~/${path}/${file.name}`;

    const result = resolveSourcePaths(sourceParameter);

    expect(result[0]).toContain(file.name);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("ENOENT: no such file or directory"),
      }),
    );
    (console.error as Mock).mockClear();
  });

  it("should return an array with multiple paths to supported files", () => {
    const path = buildPath();
    const file1 = buildFile({ extension: "mcap" });
    const file2 = buildFile({ extension: "mcap" });
    const sourceParameter = `c:/test/${path}/${file1.name},~/${path}/${file2.name},`;

    const result = resolveSourcePaths(sourceParameter);

    expect(result[0]).toContain(file1.name);
    expect(result[1]).toContain(file2.name);
  });

  it("should return an empty array after getting a path to a directory with no mcap files", () => {
    vi.spyOn(fs, "statSync").mockReturnValueOnce({
      isDirectory: () => true,
    } as Stats);
    const path = buildPath();
    const sourceParameter = `~/${path}`;

    const result = resolveSourcePaths(sourceParameter);

    expect(result).toEqual([]);

    expect(console.error).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("ENOENT: no such file or directory"),
      }),
    );
    (console.error as Mock).mockClear();
  });

  it("should return an array with mcap files after getting a path to a directory with mcap files", () => {
    const path = `/${buildPath()}`;
    const file1 = buildFile({ extension: "mcap" });
    const file3 = buildFile({ extension: "mcap" });
    vi.spyOn(fs, "statSync").mockReturnValueOnce({
      isDirectory: () => true,
    } as Stats);
    vi.spyOn(fs, "readdirSync").mockReturnValueOnce([file1.name, file3.name] as never);
    const mockSourceParameter = `~${path}`;

    const result = resolveSourcePaths(mockSourceParameter);

    expect(result.length).toBe(2);
    expect(result[0]).toContain(file1.name);
    expect(result[1]).toContain(file3.name);
  });
});
