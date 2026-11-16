/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";

import PlayerSelectionContext, {
  IDataSourceFactory,
  PlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";

import { CompareDialog, useCompareDialog } from "./CompareDialog";

vi.mock("@lichtblick/suite-base/util/showOpenFilePicker", () => ({ default: vi.fn() }));

const file = (name: string) =>
  Object.defineProperty(new File([], name), "webkitRelativePath", { value: "" });

const selection = {
  selectSource: vi.fn(),
  availableSources: [
    { id: "mcap", type: "file", supportsCompare: true, supportedFileTypes: [".mcap"] },
  ] as unknown as IDataSourceFactory[],
} as unknown as PlayerSelection;

describe("CompareDialog", () => {
  afterEach(() => {
    act(() => {
      useCompareDialog.getState().hide();
    });
  });

  it("fills the row the picker was opened from, even after a row before it was removed", async () => {
    let finishPick: (picked: File) => void = () => {};
    vi.mocked(showOpenFilePicker).mockResolvedValue([
      {
        getFile: async () =>
          await new Promise<File>((resolve) => {
            finishPick = resolve;
          }),
      } as unknown as FileSystemFileHandle,
    ]);
    render(
      <ThemeProvider isDark={false}>
        <PlayerSelectionContext.Provider value={selection}>
          <CompareDialog />
        </PlayerSelectionContext.Provider>
      </ThemeProvider>,
    );
    act(() => {
      useCompareDialog.getState().show({
        shared: [],
        sides: [
          { name: "", files: [file("a.mcap")] },
          { name: "", files: [file("b.mcap")] },
          { name: "", files: [file("c.mcap")] },
        ],
      });
    });

    // Pick more files for B, then remove A while the picked files are still being read
    fireEvent.click(screen.getAllByText("Add files")[2]!);
    await act(async () => {});
    fireEvent.click(screen.getAllByLabelText("Remove recording")[0]!);
    await act(async () => {
      finishPick(file("b2.mcap"));
    });

    expect(screen.getAllByLabelText("Recording name")).toHaveLength(2);
    const chips = [...document.querySelectorAll(".MuiChip-label")].map((chip) => chip.textContent);
    expect(chips).toEqual(["b.mcap", "b2.mcap", "c.mcap"]);
  });

  it("submits the picked files' handles so the comparison is kept in recents", async () => {
    const handle = (name: string) =>
      ({ name, getFile: async () => file(name) }) as unknown as FileSystemFileHandle;
    const base = handle("base.mcap");
    const a = handle("a.mcap");
    const b = handle("b.mcap");
    render(
      <ThemeProvider isDark={false}>
        <PlayerSelectionContext.Provider value={selection}>
          <CompareDialog />
        </PlayerSelectionContext.Provider>
      </ThemeProvider>,
    );
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });

    const pickInto = async (index: number, picked: FileSystemFileHandle) => {
      vi.mocked(showOpenFilePicker).mockResolvedValue([picked]);
      fireEvent.click(screen.getAllByText("Add files")[index]!);
      await act(async () => {});
    };
    await pickInto(0, base);
    await pickInto(1, a);
    await pickInto(2, b);
    fireEvent.click(screen.getByRole("button", { name: "Compare 2 recordings" }));

    expect(selection.selectSource).toHaveBeenLastCalledWith("mcap", {
      type: "file",
      handles: [base, a, base, b],
      compare: ["a.mcap", "a.mcap", "b.mcap", "b.mcap"],
    });
  });

  it("falls back to files when a file has no handle", () => {
    render(
      <ThemeProvider isDark={false}>
        <PlayerSelectionContext.Provider value={selection}>
          <CompareDialog />
        </PlayerSelectionContext.Provider>
      </ThemeProvider>,
    );
    const a = file("a.mcap");
    const b = file("b.mcap");
    act(() => {
      useCompareDialog.getState().show({
        shared: [],
        sides: [
          { name: "", files: [a] },
          { name: "", files: [b] },
        ],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Compare 2 recordings" }));

    expect(selection.selectSource).toHaveBeenLastCalledWith("mcap", {
      type: "file",
      files: [a, b],
      compare: ["a.mcap", "b.mcap"],
    });
  });
});
