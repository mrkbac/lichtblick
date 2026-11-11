/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";

import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutNavigation } from "@lichtblick/suite-base/hooks/useLayoutNavigation";
import LayoutBuilder from "@lichtblick/suite-base/testing/builders/LayoutBuilder";
import * as filePicker from "@lichtblick/suite-base/util/showOpenFilePicker";
import { BasicBuilder } from "@lichtblick/test-builders";

import { useLayoutTransfer } from "./useLayoutTransfer";
import { useAnalytics } from "../context/AnalyticsContext";
import { useLayoutManager } from "../context/LayoutManagerContext";

const mockEnqueueSnackbar = vi.fn();

vi.mock("notistack", () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
  enqueueSnackbar: (...args: unknown[]) => mockEnqueueSnackbar(...args),
}));

vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/hooks/useLayoutNavigation", () => ({
  useLayoutNavigation: vi.fn(),
}));

vi.mock("../context/AnalyticsContext", () => ({
  useAnalytics: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/util/showOpenFilePicker");

vi.mock("react-use", async () => ({
  ...(await vi.importActual("react-use")),
  useMountedState: () => () => true,
}));

describe("useLayoutTransfer", () => {
  const saveNewLayoutMock = vi.fn();
  const getCurrentLayoutStateMock = vi.fn();
  const onSelectLayoutMock = vi.fn();
  const promptForUnsavedChangesMock = vi.fn();
  const logEventMock = vi.fn();

  beforeEach(() => {
    (useLayoutManager as Mock).mockReturnValue({
      saveNewLayout: saveNewLayoutMock,
    });

    (useCurrentLayoutActions as Mock).mockReturnValue({
      getCurrentLayoutState: getCurrentLayoutStateMock,
    });

    (useLayoutNavigation as Mock).mockReturnValue({
      promptForUnsavedChanges: promptForUnsavedChangesMock,
      onSelectLayout: onSelectLayoutMock,
    });

    (useAnalytics as Mock).mockReturnValue({
      logEvent: logEventMock,
    });

    vi.clearAllMocks();
  });

  it("does not save a cancelled layout import", async () => {
    const controller = new AbortController();
    const content = JSON.stringify(LayoutBuilder.data()) ?? "";
    const file = new File([content], "cancelled.json");
    file.text = async () => {
      controller.abort();
      return content;
    };
    const { result } = renderHook(() => useLayoutTransfer());
    await act(async () => {
      await expect(
        result.current.parseAndInstallLayout(file, "local", controller.signal),
      ).rejects.toThrow();
    });
    expect(saveNewLayoutMock).not.toHaveBeenCalled();
    expect(onSelectLayoutMock).not.toHaveBeenCalled();
  });

  it("does not select a superseded layout when a save is already in progress", async () => {
    const controller = new AbortController();
    const layout = LayoutBuilder.layout();
    const content = JSON.stringify(LayoutBuilder.data()) ?? "";
    const file = new File([content], "cancelled.json");
    file.text = async () => content;
    saveNewLayoutMock.mockImplementationOnce(async () => {
      controller.abort();
      return layout;
    });
    const { result } = renderHook(() => useLayoutTransfer());
    await act(async () => {
      await expect(
        result.current.parseAndInstallLayout(file, "local", controller.signal),
      ).rejects.toThrow();
    });
    expect(saveNewLayoutMock).toHaveBeenCalledTimes(1);
    expect(onSelectLayoutMock).not.toHaveBeenCalled();
  });

  it("should import a layout and call onSelectLayout", async () => {
    promptForUnsavedChangesMock.mockResolvedValue(true);
    const content = JSON.stringify(LayoutBuilder.data()) ?? "";
    const mockFile = new File([content], "test-layout.json", {
      type: "application/json",
    });

    mockFile.text = async () => content;

    (filePicker.default as Mock).mockResolvedValue([
      {
        getFile: async () => mockFile,
      },
    ]);

    saveNewLayoutMock.mockResolvedValue({
      id: "123",
      name: "test-layout",
      data: content,
    });

    const { result } = renderHook(() => useLayoutTransfer());

    await act(async () => {
      await result.current.importLayout();
    });

    expect(saveNewLayoutMock).toHaveBeenCalled();
    expect(onSelectLayoutMock).toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalled();
  });

  it("should not install a layout that fails validation", async () => {
    promptForUnsavedChangesMock.mockResolvedValue(true);
    // Missing required fields such as configById, globalVariables, etc.
    const content = JSON.stringify({ foo: BasicBuilder.string() }) ?? "";
    const mockFile = new File([content], "invalid-layout.json", {
      type: "application/json",
    });

    mockFile.text = async () => content;

    (filePicker.default as Mock).mockResolvedValue([
      {
        getFile: async () => mockFile,
      },
    ]);

    const { result } = renderHook(() => useLayoutTransfer());

    await act(async () => {
      await result.current.importLayout();
    });

    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining("is not a valid layout"),
      { variant: "error" },
    );
    expect(saveNewLayoutMock).not.toHaveBeenCalled();
    expect(onSelectLayoutMock).not.toHaveBeenCalled();
  });
});
