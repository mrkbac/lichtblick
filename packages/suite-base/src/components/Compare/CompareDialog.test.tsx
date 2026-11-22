/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";

import PlayerSelectionContext, {
  IDataSourceFactory,
  PlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import WorkspaceContextProvider from "@lichtblick/suite-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { useAppLaunch } from "@lichtblick/suite-base/util/appLaunch";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";
import { takeSourcePick } from "@lichtblick/suite-base/util/sourcePick";

import { CompareDialog } from "./CompareDialog";
import { useCompareDialog } from "./compareDialogStore";

vi.mock("@lichtblick/suite-base/util/showOpenFilePicker", () => ({ default: vi.fn() }));

const file = (name: string) =>
  Object.defineProperty(new File([], name), "webkitRelativePath", { value: "" });

const selection = {
  selectSource: vi.fn(),
  availableSources: [
    { id: "mcap", type: "file", supportsCompare: true, supportedFileTypes: [".mcap"] },
    { id: "remote", type: "connection", supportedFileTypes: [".bag", ".mcap"] },
    { id: "ws", type: "connection" },
  ] as unknown as IDataSourceFactory[],
} as unknown as PlayerSelection;

function renderDialog() {
  render(
    <ThemeProvider isDark={false}>
      <WorkspaceContextProvider disablePersistenceForStorybook>
        <PlayerSelectionContext.Provider value={selection}>
          <CompareDialog />
        </PlayerSelectionContext.Provider>
      </WorkspaceContextProvider>
    </ThemeProvider>,
  );
}

/** Adds what the user opens next in the open dialog to row `index`, as a pick */
async function pickElsewhere(
  index: number,
  sourceId: string,
  url: string,
  extra: Record<string, string> = {},
) {
  fireEvent.click(screen.getAllByText("URL, recent or catalog")[index]!);
  await act(async () => {
    expect(takeSourcePick(sourceId, { type: "connection", params: { url, ...extra } })).toBe(true);
  });
}

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
    renderDialog();
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
    fireEvent.click(screen.getAllByText("Local files")[2]!);
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
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });

    const pickInto = async (index: number, picked: FileSystemFileHandle) => {
      vi.mocked(showOpenFilePicker).mockResolvedValue([picked]);
      fireEvent.click(screen.getAllByText("Local files")[index]!);
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
    renderDialog();
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

  it("adds remote recordings picked from the open dialog and compares them as one remote source", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    await pickElsewhere(1, "remote", "https://example.com/a.mcap");
    await pickElsewhere(2, "remote", "https://example.com/b.mcap");
    // The remote source splits its lists on commas
    fireEvent.change(screen.getAllByLabelText("Recording name")[1]!, {
      target: { value: "B, tuned" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compare 2 recordings" }));

    expect(selection.selectSource).toHaveBeenLastCalledWith("remote", {
      type: "connection",
      params: {
        url: "https://example.com/a.mcap,https://example.com/b.mcap",
        compareNames: "a.mcap,B%2C tuned",
      },
    });
  });

  it("mixes local files and remote recordings in one comparison", async () => {
    renderDialog();
    const a = file("a.mcap");
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [{ name: "", files: [a] }] });
    });
    await pickElsewhere(2, "remote", "https://example.com/b.mcap");
    fireEvent.click(screen.getByRole("button", { name: "Compare 2 recordings" }));

    expect(selection.selectSource).toHaveBeenLastCalledWith("mcap", {
      type: "file",
      files: [a, "https://example.com/b.mcap"],
      compare: ["a.mcap", "b.mcap"],
    });
  });

  it("refuses a live connection picked for a row", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    await pickElsewhere(1, "ws", "ws://localhost:8765");

    expect(screen.getByText(/can't be compared/)).toBeTruthy();
    expect(document.querySelectorAll(".MuiChip-label")).toHaveLength(0);
  });

  it("refuses a live connection whose URL ends in .mcap", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    await pickElsewhere(1, "ws", "ws://localhost:8765/live.mcap");

    expect(screen.getByText(/can't be compared/)).toBeTruthy();
    expect(document.querySelectorAll(".MuiChip-label")).toHaveLength(0);
  });

  it("adds a catalog recording to its row without opening it or its layout", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    vi.mocked(selection.selectSource).mockClear();
    fireEvent.click(screen.getAllByText("URL, recent or catalog")[1]!);
    // How the catalog opens a recording: an app launch with its source and layout
    await act(async () => {
      useAppLaunch.getState().launch({
        ds: "remote",
        dsParams: { url: "https://example.com/a.mcap" },
        layoutUrl: "https://example.com/layout.json",
      });
    });

    expect(useAppLaunch.getState().url).toBeUndefined();
    expect(selection.selectSource).not.toHaveBeenCalled();
    const chips = [...document.querySelectorAll(".MuiChip-label")].map((chip) => chip.textContent);
    expect(chips).toEqual(["a.mcap"]);
  });

  it("keeps the cookie setting of remote recordings and refuses conflicting ones", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    const cookies = { includeCredentials: "true" };
    await pickElsewhere(1, "remote", "https://example.com/private-a.mcap", cookies);
    await pickElsewhere(2, "remote", "https://example.com/private-b.mcap", cookies);
    // The same recording again, without cookies
    await pickElsewhere(2, "remote", "https://example.com/private-a.mcap");
    expect(screen.getByText(/different cookie setting/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Compare 2 recordings" }));
    expect(selection.selectSource).toHaveBeenLastCalledWith("remote", {
      type: "connection",
      params: {
        url: "https://example.com/private-a.mcap,https://example.com/private-b.mcap",
        compareNames: "private-a.mcap,private-b.mcap",
        includeCredentials: "true",
      },
    });
  });

  it("doesn't compare recordings with cookies alongside ones without", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    await pickElsewhere(1, "remote", "https://example.com/signed.mcap", {
      includeCredentials: "true",
    });
    await pickElsewhere(2, "remote", "https://example.com/open.mcap");

    expect(screen.getByText(/only be compared with other remote recordings/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare 2 recordings" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("doesn't carry a cookie setting over from another comparison", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    // Used with cookies in the test before; this draft picks it without
    await pickElsewhere(1, "remote", "https://example.com/private-a.mcap");
    await pickElsewhere(2, "remote", "https://example.com/open.mcap");
    fireEvent.click(screen.getByRole("button", { name: "Compare 2 recordings" }));

    expect(selection.selectSource).toHaveBeenLastCalledWith("remote", {
      type: "connection",
      params: {
        url: "https://example.com/private-a.mcap,https://example.com/open.mcap",
        compareNames: "private-a.mcap,open.mcap",
      },
    });
  });

  it("starts from the open remote comparison with its cookie setting", () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({
        shared: [],
        sides: [
          { name: "", files: ["https://example.com/x.mcap"] },
          { name: "", files: ["https://example.com/y.mcap"] },
        ],
        withCookies: ["https://example.com/x.mcap", "https://example.com/y.mcap"],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Compare 2 recordings" }));

    expect(selection.selectSource).toHaveBeenLastCalledWith("remote", {
      type: "connection",
      params: {
        url: "https://example.com/x.mcap,https://example.com/y.mcap",
        compareNames: "x.mcap,y.mcap",
        includeCredentials: "true",
      },
    });
  });

  it("checks picks that finish together against each other's cookie settings", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    const url = "https://example.com/race.mcap";
    // Both picks are handed over before either has been read and committed
    await act(async () => {
      fireEvent.click(screen.getAllByText("URL, recent or catalog")[1]!);
      takeSourcePick("remote", { type: "connection", params: { url, includeCredentials: "true" } });
      fireEvent.click(screen.getAllByText("URL, recent or catalog")[2]!);
      takeSourcePick("remote", { type: "connection", params: { url } });
    });

    expect(screen.getByText(/different cookie setting/)).toBeTruthy();
    const chips = [...document.querySelectorAll(".MuiChip-label")].map((chip) => chip.textContent);
    expect(chips).toEqual(["race.mcap"]);
  });

  it("adds a picked URL with a comma in it as one recording", async () => {
    renderDialog();
    act(() => {
      useCompareDialog.getState().show({ shared: [], sides: [] });
    });
    await pickElsewhere(1, "remote", "https://example.com/run,1.mcap");

    const chips = [...document.querySelectorAll(".MuiChip-label")].map((chip) => chip.textContent);
    expect(chips).toEqual(["run,1.mcap"]);
    expect(screen.queryByText(/can't be compared/)).toBeNull();
  });
});
