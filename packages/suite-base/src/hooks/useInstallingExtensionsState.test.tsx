/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import { useSnackbar } from "notistack";
import type { Mock } from "vitest";

import {
  ExtensionData,
  InstallExtensionsResult,
} from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { BasicBuilder } from "@lichtblick/test-builders";

import { useInstallingExtensionsState } from "./useInstallingExtensionsState";

const mockSetInstallingProgress = vi.fn();
const mockInstallExtensions = vi.fn();
const mockStore = {
  setInstallingProgress: mockSetInstallingProgress,
  installingProgress: { installed: 0, total: 0, inProgress: false },
};

vi.mock("@lichtblick/suite-base/hooks/useInstallingExtensionsStore", async () => ({
  ...(await vi.importActual("@lichtblick/suite-base/hooks/useInstallingExtensionsStore")),
  useInstallingExtensionsStore: (selector: any) => selector(mockStore),
}));

vi.mock("@lichtblick/suite-base/context/ExtensionCatalogContext", async () => ({
  ...(await vi.importActual("@lichtblick/suite-base/context/ExtensionCatalogContext")),
  useExtensionCatalog: (selector: any) =>
    selector({
      installExtensions: mockInstallExtensions,
    }),
}));

vi.mock("notistack", () => ({
  useSnackbar: vi.fn(),
}));

describe("useInstallingExtensionsState", () => {
  const playMock = vi.fn();
  const enqueueSnackbar = vi.fn();
  const closeSnackbar = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.installingProgress = { installed: 0, total: 0, inProgress: false };
    (useSnackbar as Mock).mockReturnValue({
      enqueueSnackbar,
      closeSnackbar,
    });
  });

  const createExtensionData = (count: number): ExtensionData[] => {
    return Array.from({ length: count }, () => ({
      buffer: new Uint8Array([BasicBuilder.number()]),
    }));
  };

  const createSuccessResult = (): InstallExtensionsResult => ({
    success: true,
    extensionName: BasicBuilder.string(),
    loaderResults: [{ loaderType: "browser", success: true }],
  });

  const createPartialFailureResult = (): InstallExtensionsResult => ({
    success: true,
    extensionName: BasicBuilder.string(),
    error: new Error(),
    loaderResults: [
      { loaderType: "browser", success: true },
      { loaderType: "filesystem", success: false, error: new Error("Disk error") },
    ],
  });

  const createCompleteFailureResult = (): InstallExtensionsResult => ({
    success: false,
    extensionName: BasicBuilder.string(),
    error: new Error("All loaders failed"),
    loaderResults: [
      { loaderType: "browser", success: false, error: new Error("Cache error") },
      { loaderType: "filesystem", success: false, error: new Error("Disk error") },
    ],
  });

  describe("Complete Success Scenarios", () => {
    it("should show success message when all extensions install successfully", async () => {
      // Given
      const extensionsData = createExtensionData(3);
      mockInstallExtensions
        .mockResolvedValueOnce([createSuccessResult()])
        .mockResolvedValueOnce([createSuccessResult()])
        .mockResolvedValueOnce([createSuccessResult()]);

      const { result } = renderHook(() =>
        useInstallingExtensionsState({
          isPlaying: false,
          playerEvents: { play: playMock },
        }),
      );

      // When
      await act(async () => {
        await result.current.installFoxeExtensions(extensionsData);
      });

      // Then
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        "Successfully installed all 3 extensions.",
        expect.objectContaining({ variant: "success" }),
      );
    });
  });

  describe("Partial Success with Warnings Scenarios", () => {
    it("should show warning when extensions install but another loader fails", async () => {
      // Given
      const extensionsData = createExtensionData(2);
      mockInstallExtensions
        .mockResolvedValueOnce([createPartialFailureResult()])
        .mockResolvedValueOnce([createPartialFailureResult()]);

      const { result } = renderHook(() =>
        useInstallingExtensionsState({
          isPlaying: false,
          playerEvents: { play: playMock },
        }),
      );

      // When
      await act(async () => {
        await result.current.installFoxeExtensions(extensionsData);
      });

      // Then
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        "Successfully installed all 2 extensions with some warnings.",
        expect.objectContaining({ variant: "warning" }),
      );
    });

    it("should show warning when extensions install but some fail to save to cache", async () => {
      // Given
      const extensionsData = createExtensionData(1);
      const resultWithCacheFailure: InstallExtensionsResult = {
        success: true,
        extensionName: BasicBuilder.string(),
        error: new Error(),
        loaderResults: [
          { loaderType: "browser", success: false, error: new Error("Cache error") },
          { loaderType: "filesystem", success: true },
        ],
      };
      mockInstallExtensions.mockResolvedValueOnce([resultWithCacheFailure]);

      const { result } = renderHook(() =>
        useInstallingExtensionsState({
          isPlaying: false,
          playerEvents: { play: playMock },
        }),
      );

      // When
      await act(async () => {
        await result.current.installFoxeExtensions(extensionsData);
      });

      // Then
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        "Successfully installed all 1 extensions with some warnings.",
        expect.objectContaining({ variant: "warning" }),
      );
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        "Issues: 1 extension not saved to local cache.",
        expect.objectContaining({
          variant: "warning",
          persist: true,
        }),
      );
    });
  });

  describe("Complete Failure Scenarios", () => {
    it("should show failure message when all extensions fail completely", async () => {
      // Given
      const extensionsData = createExtensionData(2);
      mockInstallExtensions
        .mockResolvedValueOnce([createCompleteFailureResult()])
        .mockResolvedValueOnce([createCompleteFailureResult()]);

      const { result } = renderHook(() =>
        useInstallingExtensionsState({
          isPlaying: false,
          playerEvents: { play: playMock },
        }),
      );

      // When
      await act(async () => {
        await result.current.installFoxeExtensions(extensionsData);
      });

      // Then
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        "Failed to install all 2 extensions.",
        expect.objectContaining({ variant: "error" }),
      );
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        "Details: 2 could not be saved to cache.",
        expect.objectContaining({
          variant: "error",
          persist: true,
        }),
      );
    });
  });

  describe("Progress and State Management", () => {
    it("should manage installation progress correctly", async () => {
      // Given
      const extensionsData = createExtensionData(2);
      mockInstallExtensions
        .mockResolvedValueOnce([createSuccessResult()])
        .mockResolvedValueOnce([createSuccessResult()]);

      const { result } = renderHook(() =>
        useInstallingExtensionsState({
          isPlaying: true,
          playerEvents: { play: playMock },
        }),
      );

      // When
      await act(async () => {
        await result.current.installFoxeExtensions(extensionsData);
      });

      // Then
      expect(mockSetInstallingProgress.mock.calls).toEqual([
        [{ installed: 0, total: 2, inProgress: true }],
        [{ installed: 1, total: 2, inProgress: true }],
        [{ installed: 2, total: 2, inProgress: true }],
        [{ installed: 0, total: 0, inProgress: false }],
      ]);
      expect(playMock).toHaveBeenCalled();
    });

    it("should show progress snackbar when installation is in progress", () => {
      // Given
      const extensionsToBeInstalled = BasicBuilder.number();
      mockStore.installingProgress = {
        installed: 0,
        total: extensionsToBeInstalled,
        inProgress: true,
      };

      // When
      renderHook(() =>
        useInstallingExtensionsState({
          isPlaying: false,
          playerEvents: { play: playMock },
        }),
      );

      // Then
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        `Installing ${extensionsToBeInstalled} extensions...`,
        expect.objectContaining({
          variant: "info",
          persist: true,
          preventDuplicate: true,
        }),
      );
    });
  });

  describe("Error Handling", () => {
    it("should show error message when installation process throws exception", async () => {
      // Given
      const errorMessage = BasicBuilder.string();
      const error = new Error(errorMessage);
      const extensionsData = createExtensionData(1);
      mockInstallExtensions.mockRejectedValue(error);

      const { result } = renderHook(() =>
        useInstallingExtensionsState({
          isPlaying: false,
          playerEvents: { play: playMock },
        }),
      );

      // When
      await act(async () => {
        await result.current.installFoxeExtensions(extensionsData);
      });

      // Then
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        `An error occurred during extension installation: ${errorMessage}`,
        expect.objectContaining({ variant: "error" }),
      );
      expect(mockSetInstallingProgress).toHaveBeenLastCalledWith({
        installed: 0,
        total: 0,
        inProgress: false,
      });
    });
  });
});
