/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook, act } from "@testing-library/react";
import type { Mock } from "vitest";

import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { LayoutSetupOptions } from "@lichtblick/suite-base/hooks/types";
import { useConfirm } from "@lichtblick/suite-base/hooks/useConfirm";
import { useLayoutActions } from "@lichtblick/suite-base/hooks/useLayoutActions";
import { useLayoutNavigation } from "@lichtblick/suite-base/hooks/useLayoutNavigation";
import MockLayoutManager from "@lichtblick/suite-base/services/LayoutManager/MockLayoutManager";
import LayoutBuilder from "@lichtblick/suite-base/testing/builders/LayoutBuilder";
import { BasicBuilder } from "@lichtblick/test-builders";

vi.mock("@lichtblick/suite-base/context/LayoutManagerContext", () => ({
  useLayoutManager: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutActions: vi.fn(),
  useCurrentLayoutSelector: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/hooks/useLayoutNavigation", () => ({
  useLayoutNavigation: vi.fn().mockReturnValue({
    onSelectLayout: vi.fn(),
  }),
}));

vi.mock("@lichtblick/suite-base/hooks/useConfirm", () => ({
  useConfirm: vi.fn().mockReturnValue([vi.fn().mockResolvedValue("ok"), undefined]),
}));

function setup(options: Partial<LayoutSetupOptions> = {}) {
  const {
    state = {
      busy: false,
      error: undefined,
      online: true,
      lastSelectedId: undefined,
      multiAction: undefined,
      selectedIds: [] as string[],
    },
    dispatch = vi.fn(),
  } = options;

  const { result } = renderHook(() => useLayoutActions({ state, dispatch }));
  return { result, dispatch };
}

describe("useLayoutActions", () => {
  let setSelectedLayoutIdMock: Mock;
  let onSelectLayoutMock: Mock;
  let confirmMock: Mock;
  const mockLayoutManager = new MockLayoutManager();

  beforeEach(() => {
    mockLayoutManager.updateLayout = vi.fn().mockResolvedValue(undefined);
    mockLayoutManager.deleteLayout = vi.fn().mockResolvedValue(undefined);
    mockLayoutManager.overwriteLayout = vi.fn().mockResolvedValue(undefined);
    mockLayoutManager.revertLayout = vi.fn().mockResolvedValue(undefined);
    mockLayoutManager.getLayouts = vi.fn().mockResolvedValue([]);
    setSelectedLayoutIdMock = vi.fn();
    onSelectLayoutMock = vi.fn();
    confirmMock = vi.fn().mockResolvedValue("ok");

    (useLayoutManager as Mock).mockReturnValue(mockLayoutManager);
    (useCurrentLayoutActions as Mock).mockReturnValue({
      setSelectedLayoutId: setSelectedLayoutIdMock,
    });
    (useLayoutNavigation as Mock).mockReturnValue({
      onSelectLayout: onSelectLayoutMock,
    });
    (useConfirm as Mock).mockReturnValue([confirmMock, undefined]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onRenameLayout", () => {
    it("calls updateLayout, setSelectedLayoutId, and logs event", async () => {
      const { result } = setup();
      const mockLayout = LayoutBuilder.layout({ permission: "CREATOR_WRITE" });
      const newName = BasicBuilder.string();

      await act(async () => {
        await result.current.onRenameLayout(mockLayout, newName);
      });

      expect(mockLayoutManager.updateLayout).toHaveBeenCalledWith({
        id: mockLayout.id,
        name: newName,
      });
      expect(setSelectedLayoutIdMock).toHaveBeenCalledWith(mockLayout.id);
    });
  });

  describe("onDuplicateLayout", () => {
    it("keeps a linked layout's copy untrusted", async () => {
      mockLayoutManager.saveNewLayout = vi.fn().mockResolvedValue(LayoutBuilder.layout());
      const { result } = setup();

      await act(async () => {
        await result.current.onDuplicateLayout({ ...LayoutBuilder.layout(), untrusted: true });
      });

      expect(mockLayoutManager.saveNewLayout).toHaveBeenCalledWith(
        expect.objectContaining({ untrusted: true }),
      );
    });

    it("saves new layout, selects it, and logs event", async () => {
      const newLayout = LayoutBuilder.layout();
      mockLayoutManager.saveNewLayout = vi.fn().mockResolvedValue(newLayout);

      const { result } = setup();
      const mockLayout = LayoutBuilder.layout({ permission: "CREATOR_WRITE" });

      await act(async () => {
        await result.current.onDuplicateLayout(mockLayout);
      });

      expect(mockLayoutManager.saveNewLayout).toHaveBeenCalledWith({
        name: `${mockLayout.name} copy`,
        data: mockLayout.working?.data ?? mockLayout.baseline.data,
        permission: "CREATOR_WRITE",
      });
      expect(onSelectLayoutMock).toHaveBeenCalledWith(newLayout);
    });

    it("dispatches queue-multi-action when multiple layouts are selected", async () => {
      const { result, dispatch } = setup({
        state: {
          busy: false,
          error: undefined,
          online: true,
          lastSelectedId: undefined,
          multiAction: undefined,
          selectedIds: ["id1", "id2"],
        },
      });

      await act(async () => {
        await result.current.onDuplicateLayout(LayoutBuilder.layout());
      });

      expect(dispatch).toHaveBeenCalledWith({
        type: "queue-multi-action",
        action: "duplicate",
      });
      expect(mockLayoutManager.saveNewLayout).not.toHaveBeenCalled();
      expect(onSelectLayoutMock).not.toHaveBeenCalled();
    });
  });

  describe("onDeleteLayout", () => {
    it("deletes the layout and logs event", async () => {
      const { result } = setup();
      const mockLayout = LayoutBuilder.layout({ permission: "CREATOR_WRITE" });

      await act(async () => {
        await result.current.onDeleteLayout(mockLayout);
      });

      expect(mockLayoutManager.deleteLayout).toHaveBeenCalledWith({ id: mockLayout.id });
    });

    it("dispatches queue-multi-action when multiple layouts are selected", async () => {
      const { result, dispatch } = setup({
        state: {
          busy: false,
          error: undefined,
          online: true,
          lastSelectedId: undefined,
          multiAction: undefined,
          selectedIds: ["id1", "id2"],
        },
      });

      await act(async () => {
        await result.current.onDeleteLayout(LayoutBuilder.layout());
      });

      expect(dispatch).toHaveBeenCalledWith({ type: "queue-multi-action", action: "delete" });
      expect(mockLayoutManager.deleteLayout).not.toHaveBeenCalled();
      expect(onSelectLayoutMock).not.toHaveBeenCalled();
    });
  });

  describe("onRevertLayout", () => {
    it("reverts the layout and logs event", async () => {
      const { result } = setup();
      const mockLayout = LayoutBuilder.layout({ permission: "CREATOR_WRITE" });

      await act(async () => {
        await result.current.onRevertLayout(mockLayout);
      });

      expect(mockLayoutManager.revertLayout).toHaveBeenCalledWith({ id: mockLayout.id });
    });

    it("dispatches queue-multi-action when multiple layouts are selected", async () => {
      const { result, dispatch } = setup({
        state: {
          busy: false,
          error: undefined,
          online: true,
          lastSelectedId: undefined,
          multiAction: undefined,
          selectedIds: ["id1", "id2"],
        },
      });

      await act(async () => {
        await result.current.onRevertLayout(LayoutBuilder.layout());
      });

      expect(dispatch).toHaveBeenCalledWith({ type: "queue-multi-action", action: "revert" });
      expect(mockLayoutManager.revertLayout).not.toHaveBeenCalled();
      expect(onSelectLayoutMock).not.toHaveBeenCalled();
    });
  });

  describe("onOverwriteLayout", () => {
    it("overwrites a personal layout without confirmation and logs event", async () => {
      const { result } = setup();
      const mockLayout = LayoutBuilder.layout({ permission: "CREATOR_WRITE" });

      await act(async () => {
        await result.current.onOverwriteLayout(mockLayout);
      });

      expect(confirmMock).not.toHaveBeenCalled();
      expect(mockLayoutManager.overwriteLayout).toHaveBeenCalledWith({ id: mockLayout.id });
    });

    it("asks confirmation before overwriting a shared layout and proceeds on ok", async () => {
      const { result } = setup();
      const mockLayout = LayoutBuilder.layout({ permission: "ORG_READ" });

      await act(async () => {
        await result.current.onOverwriteLayout(mockLayout);
      });

      expect(confirmMock).toHaveBeenCalled();
      expect(mockLayoutManager.overwriteLayout).toHaveBeenCalledWith({ id: mockLayout.id });
    });

    it("cancels overwrite of shared layout when user dismisses confirmation", async () => {
      confirmMock.mockResolvedValue("cancel");
      const { result } = setup();
      const mockLayout = LayoutBuilder.layout({ permission: "ORG_READ" });

      await act(async () => {
        await result.current.onOverwriteLayout(mockLayout);
      });

      expect(mockLayoutManager.overwriteLayout).not.toHaveBeenCalled();
    });

    it("dispatches queue-multi-action when multiple layouts are selected", async () => {
      const { result, dispatch } = setup({
        state: {
          busy: false,
          error: undefined,
          online: true,
          lastSelectedId: undefined,
          multiAction: undefined,
          selectedIds: ["id1", "id2"],
        },
      });

      await act(async () => {
        await result.current.onOverwriteLayout(LayoutBuilder.layout());
      });

      expect(dispatch).toHaveBeenCalledWith({ type: "queue-multi-action", action: "save" });
      expect(mockLayoutManager.overwriteLayout).not.toHaveBeenCalled();
    });
  });
});
