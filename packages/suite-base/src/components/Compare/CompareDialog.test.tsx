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
});
