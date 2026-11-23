/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, render } from "@testing-library/react";
import type { Mock } from "vitest";

import {
  CurrentLayoutLocalStorageSyncAdapter,
  flushPendingLayoutSave,
  selectLayoutData,
  selectLayoutId,
} from "@lichtblick/suite-base/components/CurrentLayoutLocalStorageSyncAdapter";
import { LOCAL_STORAGE_STUDIO_LAYOUT_KEY } from "@lichtblick/suite-base/constants/browserStorageKeys";
import {
  LayoutData,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import MockCurrentLayoutProvider from "@lichtblick/suite-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import MockLayoutManager from "@lichtblick/suite-base/services/LayoutManager/MockLayoutManager";
import LayoutBuilder from "@lichtblick/suite-base/testing/builders/LayoutBuilder";

vi.mock("@lichtblick/suite-base/context/CurrentLayoutContext", async () => {
  const originalModule = await vi.importActual(
    "@lichtblick/suite-base/context/CurrentLayoutContext",
  );
  return {
    __esModule: true,
    ...originalModule,
    useCurrentLayoutActions: vi.fn(),
    useCurrentLayoutSelector: vi.fn(),
  };
});

vi.mock("@lichtblick/suite-base/context/LayoutManagerContext", async () => {
  const originalModule = await vi.importActual(
    "@lichtblick/suite-base/context/LayoutManagerContext",
  );
  return {
    __esModule: true,
    ...originalModule,
    useLayoutManager: vi.fn(),
  };
});

describe("CurrentLayoutLocalStorageSyncAdapter", () => {
  const mockGetCurrentLayoutState = vi.fn();
  const mockLayoutManager = new MockLayoutManager();
  const mockLayoutData: LayoutData = LayoutBuilder.layout().baseline.data;
  const mockLayoutId = LayoutBuilder.layoutId();

  beforeEach(() => {
    vi.clearAllMocks();
    (useCurrentLayoutActions as Mock).mockReturnValue({
      getCurrentLayoutState: mockGetCurrentLayoutState,
    });
    (useCurrentLayoutSelector as Mock).mockImplementation((selector) => {
      if (selector === selectLayoutData) {
        return mockLayoutData;
      }
      if (selector === selectLayoutId) {
        return mockLayoutId;
      }
      return undefined;
    });
    (useLayoutManager as Mock).mockReturnValue(mockLayoutManager);
    localStorage.clear();
  });

  function renderComponent() {
    // A fresh element each time, so React re-renders the adapter instead of bailing out.
    const component = () => (
      <MockCurrentLayoutProvider>
        <CurrentLayoutLocalStorageSyncAdapter />
      </MockCurrentLayoutProvider>
    );
    const renderObj = render(component());

    return {
      ...renderObj,
      rerender: () => {
        renderObj.rerender(component());
      },
    };
  }

  it("saves layout data to localStorage when it changes", async () => {
    // Given
    renderComponent();

    // When
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300)); // Wait for debounce
    });

    // Then
    const storedData = localStorage.getItem(LOCAL_STORAGE_STUDIO_LAYOUT_KEY);
    expect(storedData).toBe(JSON.stringify(mockLayoutData));
  });

  it("writes a pending edit at once when flushed, without waiting for the debounce", async () => {
    const { rerender } = renderComponent();
    const modifiedData = { ...mockLayoutData, modified: true };
    (useCurrentLayoutSelector as Mock).mockImplementation((selector) =>
      selector === selectLayoutData ? modifiedData : mockLayoutId,
    );
    await act(async () => {
      rerender();
    });
    expect(localStorage.getItem(LOCAL_STORAGE_STUDIO_LAYOUT_KEY)).toBe(
      JSON.stringify(mockLayoutData),
    );

    let pending = false;
    await act(async () => {
      pending = flushPendingLayoutSave();
    });

    expect(pending).toBe(true);
    expect(localStorage.getItem(LOCAL_STORAGE_STUDIO_LAYOUT_KEY)).toBe(
      JSON.stringify(modifiedData),
    );
    expect(flushPendingLayoutSave()).toBe(false); // nothing left
  });

  it("sends new layout data to layoutManager after initial load", async () => {
    // Given
    mockGetCurrentLayoutState.mockReturnValue({
      selectedLayout: { id: mockLayoutId, data: mockLayoutData },
    });

    // When
    const { rerender } = renderComponent();

    // Verify initial call was skipped
    expect(mockLayoutManager.updateLayout).not.toHaveBeenCalled();

    // Now simulate a data change by updating the mock to return different data
    const modifiedData = { ...mockLayoutData, modified: true };

    (useCurrentLayoutSelector as Mock).mockImplementation((selector) => {
      if (selector === selectLayoutData) {
        return modifiedData;
      }
      if (selector === selectLayoutId) {
        return mockLayoutId;
      }
      return undefined;
    });

    // Force a re-render to trigger useAsync with new data
    await act(async () => {
      rerender();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 300)); // Wait for debounce
    });

    // Then - should be called on the second execution
    expect(mockLayoutManager.updateLayout).toHaveBeenCalledWith({
      id: mockLayoutId,
      data: modifiedData,
    });
  });

  it("saves an edit made just before switching layouts to the layout it was made in", async () => {
    const { rerender } = renderComponent();
    const select = (id: string, data: LayoutData) => {
      (useCurrentLayoutSelector as Mock).mockImplementation((selector) =>
        selector === selectLayoutData ? data : selector === selectLayoutId ? id : undefined,
      );
    };

    // An edit, then a switch to another layout within the debounce
    const editedData = { ...mockLayoutData, modified: true };
    select(mockLayoutId, editedData);
    await act(async () => {
      rerender();
    });
    select("other-layout", { ...mockLayoutData, globalVariables: { other: true } });
    await act(async () => {
      rerender();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    // The edit lands on the first layout; loading the second is not an edit
    expect(mockLayoutManager.updateLayout).toHaveBeenCalledTimes(1);
    expect(mockLayoutManager.updateLayout).toHaveBeenCalledWith({
      id: mockLayoutId,
      data: editedData,
    });
  });
});
