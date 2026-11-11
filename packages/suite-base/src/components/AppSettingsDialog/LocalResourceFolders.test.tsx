/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { localResourceFolders } from "@lichtblick/suite-base/util/localResourceFolders";

import { LocalResourceFolders } from "./LocalResourceFolders";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("explains unsupported folder access", () => {
  render(<LocalResourceFolders />);
  expect(screen.getByRole("button", { name: "Select resource folder" })).toBeDisabled();
  expect(screen.getByText(/This browser does not support folder access/)).toBeVisible();
});

it("requests read-only access, scans the grant, and reports permission failures", async () => {
  const handle = { name: "workspace" } as FileSystemDirectoryHandle;
  const picker = vi.fn().mockResolvedValue(handle);
  vi.stubGlobal("showDirectoryPicker", picker);
  const add = vi
    .spyOn(localResourceFolders, "add")
    .mockRejectedValue(new DOMException("Access denied", "NotAllowedError"));
  render(<LocalResourceFolders />);
  fireEvent.click(screen.getByRole("button", { name: "Select resource folder" }));
  await waitFor(() => {
    expect(add).toHaveBeenCalledWith(handle);
  });
  expect(picker).toHaveBeenCalledWith({ id: "lichtblick-ros-resources", mode: "read" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
});

it("treats cancelling the picker as a normal action", async () => {
  const picker = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
  vi.stubGlobal("showDirectoryPicker", picker);
  render(<LocalResourceFolders />);
  fireEvent.click(screen.getByRole("button", { name: "Select resource folder" }));
  await waitFor(() => {
    expect(picker).toHaveBeenCalledTimes(1);
  });
  expect(screen.queryByRole("alert")).toBeNull();
});
