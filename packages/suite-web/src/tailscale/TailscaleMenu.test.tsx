// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { MenuList } from "@mui/material";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { openDialog } from "@lichtblick/suite-base/i18n/en/openDialog";

import TailscaleMenu from "./TailscaleMenu";
import type { SessionStatus } from "./worker";

const start = vi.fn();
const logout = vi.fn();
const close = vi.fn();
let status: SessionStatus;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: keyof typeof openDialog) => openDialog[key] }),
}));
vi.mock("./TailscaleAccount", () => ({
  useTailscaleAccount: () => ({ status, start, logout }),
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
  });

  it("shows sign-out without putting device connections in the account menu", () => {
    status = { state: "Running", peers: [{ name: "device.example.ts.net", online: true }] };
    showMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out of Tailscale" }));
    expect(logout).toHaveBeenCalledOnce();
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
