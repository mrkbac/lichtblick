// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { MenuList } from "@mui/material";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { openDialog } from "@lichtblick/suite-base/i18n/en/openDialog";

import TailscaleMenu from "./TailscaleMenu";
import type { SessionStatus } from "./worker";

const start = vi.fn();
const logout = vi.fn();
const selectSource = vi.fn();
const close = vi.fn();
let status: SessionStatus;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: keyof typeof openDialog) => openDialog[key] }),
}));
vi.mock("./TailscaleAccount", () => ({
  useTailscaleAccount: () => ({ status, start, logout }),
}));
vi.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: () => ({ selectSource }),
}));

function showMenu() {
  return render(
    <MenuList>
      <TailscaleMenu onClose={close} />
    </MenuList>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  status = { state: "Running", peers: [] };
});
afterEach(cleanup);

describe("Tailscale profile menu", () => {
  it("starts the account client on open and links to Tailscale for sign-in", () => {
    status = { state: "NeedsLogin", peers: [], login: "https://login.tailscale.com/" };
    showMenu();
    expect(start).toHaveBeenCalledOnce();
    const link = screen.getByRole("menuitem", { name: "Sign in to Tailscale" });
    expect(link.getAttribute("href")).toBe(status.login);
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(selectSource).not.toHaveBeenCalled();
  });

  it.each([
    ["one.example.ts.net", "one", "ws://one.example.ts.net:8765"],
    ["2001:db8::1", "2001:db8::1", "ws://[2001:db8::1]:8765"],
  ])("connects to %s in one click", (peer, label, url) => {
    status = { state: "Running", peers: [peer] };
    showMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(selectSource).toHaveBeenCalledExactlyOnceWith("tailscale", {
      type: "connection",
      params: { url },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("filters long tailnets, orders device names and opens a unique match with Enter", () => {
    status = {
      state: "Running",
      peers: Array.from({ length: 10 }, (_, i) => `device-${10 - i}.example.ts.net`),
    };
    showMenu();
    expect(
      screen
        .getAllByRole("menuitem")
        .slice(0, 3)
        .map((item) => item.textContent),
    ).toEqual(["device-1", "device-2", "device-3"]);
    const filter = screen.getByRole("textbox", { name: "Filter devices" });
    filter.focus();
    fireEvent.keyDown(filter, { key: "d" });
    expect(document.activeElement).toBe(filter);
    fireEvent.change(filter, { target: { value: "ICE-10" } });
    expect(screen.queryByRole("menuitem", { name: "device-1" })).toBeNull();
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(selectSource).toHaveBeenCalledExactlyOnceWith("tailscale", {
      type: "connection",
      params: { url: "ws://device-10.example.ts.net:8765" },
    });
  });

  it("keeps custom addresses editable, validates the URL and connects on Enter", () => {
    showMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom bridge address…" }));
    const input = screen.getByRole("textbox", { name: "Foxglove bridge URL" });
    fireEvent.change(input, { target: { value: "https://example.test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(close).not.toHaveBeenCalled();
    const url = "wss://example.test:9000/custom";
    fireEvent.change(input, { target: { value: url } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(selectSource).toHaveBeenCalledExactlyOnceWith("tailscale", {
      type: "connection",
      params: { url },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("offers retry on failure and allows clearing a failed stored identity", () => {
    status = { state: "Failed", peers: [], error: "tailscaleStorageError" };
    showMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Retry Tailscale connection" }));
    expect(start).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out of Tailscale" }));
    expect(logout).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
