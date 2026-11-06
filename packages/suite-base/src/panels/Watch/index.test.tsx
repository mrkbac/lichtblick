/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { composeStories } from "storybook-react-rsbuild";
import type { Mock } from "vitest";

import * as stories from "./index.stories";

const { Default, Empty, Stale } = composeStories(stories);

describe("Watch", () => {
  it("shows the latest value of each row", async () => {
    render(<Default />);
    await waitFor(() => {
      expect(screen.getByText("12.35")).toBeInTheDocument();
    });
    const values = screen
      .getAllByTestId("watch-row")
      .map((row) => row.querySelector("[data-value]")?.textContent);
    expect(values).toEqual([
      "12.35",
      "44.4",
      "MOVING (1)",
      '"forward"',
      "true",
      "(6) [1.5, 2.25, 3, 4, …]",
      "{x, y}",
      "—",
    ]);
    const names = screen
      .getAllByTestId("watch-row")
      .map((row) => row.querySelector("[role=button]")?.textContent);
    expect(names.slice(0, 3)).toEqual(["Speed", "Speed", "/state.mode"]);
    expect(screen.getByText("km/h")).toBeInTheDocument();
    // The invalid path is logged by the parser
    (console.error as Mock).mockClear();
  });

  it("repaints rows when the panel is resized", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        public constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        public observe() {}
        public disconnect() {}
      },
    );
    try {
      render(<Default />);
      await waitFor(() => {
        expect(screen.getByText("12.35")).toBeInTheDocument();
      });
      const value = screen.getAllByTestId("watch-row")[0]!.querySelector("[data-value]")!;
      value.textContent = "stale";
      act(() => {
        for (const callback of callbacks) {
          callback([], {} as ResizeObserver);
        }
      });
      expect(value.textContent).toBe("12.35");
      (console.error as Mock).mockClear();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks stale values even with the age column hidden", async () => {
    render(<Stale />);
    await waitFor(() => {
      expect(screen.getAllByTestId("watch-row")[0]).toHaveAttribute("data-stale", "true");
    });
    expect(document.querySelector("[data-age]")).toBeNull();
    // The invalid path is logged by the parser
    (console.error as Mock).mockClear();
  });

  it("explains how to add rows when empty", () => {
    render(<Empty />);
    expect(screen.getByText("Watch many values in one table")).toBeInTheDocument();
  });

  it("adds a typed path on Enter; an Enter that picked a suggestion only fills the input", async () => {
    const user = userEvent.setup();
    render(<Empty />);
    const input = screen.getByPlaceholderText("Add message path…");
    await user.click(input);
    await user.type(input, "/state.speed");
    // What the path input does when Enter picks a suggestion: handle the key, then blur
    const pick = (event: KeyboardEvent) => {
      event.preventDefault();
      input.blur();
    };
    input.addEventListener("keydown", pick, { once: true });
    await user.keyboard("{Enter}");
    expect(input).toHaveFocus();
    expect(screen.queryAllByTestId("watch-row")).toHaveLength(0);

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getAllByTestId("watch-row")).toHaveLength(1);
    });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("shows an expanded message as a tree whose fields can become rows", async () => {
    const user = userEvent.setup();
    render(<Empty />);
    const input = screen.getByPlaceholderText("Add message path…");
    await user.type(input, "/state.pose{Enter}/state.ok{Enter}");
    await waitFor(() => {
      expect(screen.getByText("{x, y}")).toBeInTheDocument();
    });
    await user.click(within(screen.getAllByTestId("watch-row")[0]!).getByLabelText("Expand"));
    const tree = await screen.findByTestId("watch-tree");
    expect(tree).toHaveTextContent("x1y2");
    await user.click(within(tree).getAllByLabelText(/Add as row/)[1]!);
    // Inserted right below the row it came from
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("watch-row")
          .map((row) => row.querySelector("[role=button]")?.textContent),
      ).toEqual(["/state.pose", "/state.pose.y", "/state.ok"]);
    });
  });
});
