/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, screen, fireEvent } from "@testing-library/react";
import type { Mock } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useOtherTabCount } from "@lichtblick/suite-base/util/broadcast/useOtherTabCount";

import SyncInstanceToggle from "./SyncInstanceToggle";

vi.mock("@lichtblick/suite-base/context/Workspace/WorkspaceContext", () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/util/broadcast/useOtherTabCount", () => ({
  useOtherTabCount: vi.fn(),
}));

describe("SyncInstanceToggle", () => {
  const setSyncInstancesMock = vi.fn();

  function setup({
    syncInstances,
    otherTabs,
  }: {
    syncInstances: boolean;
    otherTabs: number | undefined;
  }) {
    (useWorkspaceActions as Mock).mockReturnValue({
      playbackControlActions: { setSyncInstances: setSyncInstancesMock },
    });
    (useWorkspaceStore as Mock).mockImplementation((selector: any) =>
      selector({ playbackControls: { syncInstances } }),
    );
    (useOtherTabCount as Mock).mockReturnValue(otherTabs);
    render(<SyncInstanceToggle />);
    return screen.getByTestId("sync-tabs-button");
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("turns sync on when another tab is open", () => {
    const button = setup({ syncInstances: false, otherTabs: 1 });

    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(setSyncInstancesMock).toHaveBeenCalledWith(true);
  });

  it("turns sync off", () => {
    const button = setup({ syncInstances: true, otherTabs: 2 });

    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(setSyncInstancesMock).toHaveBeenCalledWith(false);
  });

  it("is disabled but still rendered when no other tab is open", () => {
    const button = setup({ syncInstances: true, otherTabs: 0 });

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName("Turn on tab sync");
  });

  it("stays enabled when the tab count is unknown", () => {
    expect(setup({ syncInstances: false, otherTabs: undefined })).toBeEnabled();
  });

  it("explains itself on hover", async () => {
    const button = setup({ syncInstances: false, otherTabs: 0 });

    fireEvent.mouseOver(button.parentElement!);
    expect(await screen.findByText(/Open Lichtblick in another tab/)).toBeInTheDocument();
  });
});
