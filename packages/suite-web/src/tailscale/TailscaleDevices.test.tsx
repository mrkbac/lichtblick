// SPDX-License-Identifier: MPL-2.0
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { openDialog } from "@lichtblick/suite-base/i18n/en/openDialog";

import TailscaleDevices from "./TailscaleDevices";
import type { SessionStatus } from "./worker";

const start = vi.fn();
const selectSource = vi.fn();
let status: SessionStatus;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: keyof typeof openDialog) => openDialog[key] }),
}));
vi.mock("./TailscaleAccount", () => ({
  useTailscaleAccount: () => ({ status, start }),
}));
vi.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: () => ({ selectSource }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  status = { state: "Running", peers: [] };
});
afterEach(cleanup);

describe("Tailscale devices in Live", () => {
  it("shows availability, sorts online devices first and connects on click", () => {
    status.peers = [
      { name: "a.example.ts.net", online: false },
      { name: "z.example.ts.net", online: true },
      { name: "2001:db8::1", label: "Workshop device" },
    ];
    const { rerender } = render(<TailscaleDevices query="" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("z.example.ts.net");
    expect(screen.getByText("Online")).toBeDefined();
    expect(screen.getByText("Offline")).toBeDefined();
    expect(screen.getByText("Status unknown")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /z\.example\.ts\.net/ }));
    expect(selectSource).toHaveBeenLastCalledWith("tailscale", {
      type: "connection",
      params: { url: "ws://z.example.ts.net:8765" },
    });

    rerender(<TailscaleDevices query=" WORKSHOP " />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Workshop device")).toBeDefined();
    rerender(<TailscaleDevices query=" DB8 " />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /2001:db8::1/ }));
    expect(selectSource).toHaveBeenLastCalledWith("tailscale", {
      type: "connection",
      params: { url: "ws://[2001:db8::1]:8765" },
    });
  });

  it("opens a custom bridge after a valid URL is entered", () => {
    render(<TailscaleDevices query="" />);
    fireEvent.click(screen.getByRole("button", { name: "Custom bridge address…" }));
    const field = screen.getByRole("textbox", { name: "Foxglove bridge URL" });
    fireEvent.change(field, { target: { value: "https://example.test" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(selectSource).not.toHaveBeenCalled();
    const url = "wss://example.test:9000/custom";
    fireEvent.change(field, { target: { value: url } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(selectSource).toHaveBeenCalledExactlyOnceWith("tailscale", {
      type: "connection",
      params: { url },
    });
  });

  it("directs signed-out users to the profile menu", () => {
    status = { state: "NeedsLogin", peers: [] };
    render(<TailscaleDevices query="" />);
    expect(screen.getByText(openDialog.tailscaleProfileLogin)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
