/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";

import { ExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { IExtensionLoader } from "@lichtblick/suite-base/services/extension/IExtensionLoader";

import { useDirectoryExtensions } from "./useDirectoryExtensions";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), loaders: [] as IExtensionLoader[] }));
vi.mock("@lichtblick/suite-base/context/SharedRootContext", () => ({
  useSharedRootContext: () => ({ extensionLoaders: mocks.loaders }),
}));
vi.mock("@lichtblick/suite-base/context/ExtensionCatalogContext", () => ({
  useExtensionCatalog: (
    select: (state: Pick<ExtensionCatalog, "refreshAllExtensions">) => unknown,
  ) => select({ refreshAllExtensions: mocks.refresh }),
}));

beforeEach(() => {
  mocks.loaders = [];
  mocks.refresh.mockReset().mockResolvedValue(undefined);
});

function loader(): IExtensionLoader {
  return {
    namespace: "local",
    type: "browser",
    loadExtensionFromDirectory: vi.fn(),
    getExtension: vi.fn(),
    getExtensions: vi.fn(),
    loadExtension: vi.fn(),
    installExtension: vi.fn(),
    uninstallExtension: vi.fn(),
  };
}

it("has no folder controls for desktop or unsupported browsers", () => {
  expect(renderHook(useDirectoryExtensions).result.current.directoryLoader).toBeUndefined();
});

it("selects a directory then refreshes the catalog", async () => {
  const disk = loader();
  mocks.loaders = [disk];
  const { result } = renderHook(useDirectoryExtensions);
  await act(async () => {
    await result.current.updateDirectories("select");
  });
  expect(disk.loadExtensionFromDirectory).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(result.current.directoryBusy).toBe(false);
});

it("surfaces saved errors and refreshes without reopening the picker", async () => {
  const disk = { ...loader(), directoryErrors: ["Folder access expired"] };
  mocks.loaders = [disk];
  const { result } = renderHook(useDirectoryExtensions);
  expect(result.current.directoryError).toBe("Folder access expired");
  await act(async () => {
    await result.current.updateDirectories("reload");
  });
  expect(disk.loadExtensionFromDirectory).not.toHaveBeenCalled();
  expect(result.current.directoryError).toBe("Folder access expired");
});

it.each([
  ["AbortError", undefined],
  ["NotAllowedError", "Access refused"],
])("handles %s and releases the busy state", async (name, expected) => {
  mocks.loaders = [
    {
      ...loader(),
      loadExtensionFromDirectory: vi
        .fn()
        .mockRejectedValue(new DOMException("Access refused", name)),
    },
  ];
  const { result } = renderHook(useDirectoryExtensions);
  await act(async () => {
    await result.current.updateDirectories("select");
  });
  expect(result.current.directoryError).toBe(expected);
  expect(result.current.directoryBusy).toBe(false);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
