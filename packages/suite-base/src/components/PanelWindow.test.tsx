/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createContext, useContext, useEffect } from "react";

import { PanelWindow, PanelWindowContext } from "./PanelWindow";

const SharedContext = createContext("shared player");
const mounted = vi.fn();
const disposed = vi.fn();
function Content() {
  const actions = useContext(PanelWindowContext)!;
  const player = useContext(SharedContext);
  useEffect(() => {
    mounted();
    return disposed;
  }, []);
  return (
    <div data-testid="content">
      {player}
      <button
        onClick={() => {
          actions.open("popout");
        }}
      >
        Pop out
      </button>
      {actions.supportsPiP && (
        <button
          onClick={() => {
            actions.open("pip");
          }}
        >
          PiP
        </button>
      )}
      <button onClick={actions.close}>Return</button>
    </div>
  );
}

function childWindow() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const child = iframe.contentWindow!;
  const focus = vi.spyOn(child, "focus").mockImplementation(() => {});
  const close = vi.spyOn(child, "close").mockImplementation(() => {
    child.dispatchEvent(new Event("pagehide"));
  });
  return { child, focus, close, iframe };
}

beforeEach(() => {
  mounted.mockClear();
  disposed.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll("iframe").forEach((el) => {
    el.remove();
  });
});

it("renders one panel in the child, shares context, and restores it on close", async () => {
  const { child, close } = childWindow();
  vi.spyOn(window, "open").mockReturnValue(child);
  render(
    <SharedContext.Provider value="same connection">
      <PanelWindow title="Monitor">
        <Content />
      </PanelWindow>
    </SharedContext.Provider>,
  );
  fireEvent.click(screen.getByText("Pop out"));
  await waitFor(() => {
    expect(child.document.querySelector('[data-testid="content"]')).not.toBeNull();
  });
  expect(within(child.document.body).getByText("same connection")).toBeDefined();
  expect(document.querySelector('[data-testid="content"]')).toBeNull();
  expect(mounted).toHaveBeenCalledTimes(2);
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(child.document.title).toBe("Monitor");
  act(() => {
    child.dispatchEvent(new Event("pagehide"));
  });
  expect(screen.getByText("same connection")).toBeDefined();
  expect(mounted).toHaveBeenCalledTimes(3);
  expect(disposed).toHaveBeenCalledTimes(2);
  expect(close).not.toHaveBeenCalled();
});

it("hides PiP without API support and reports a blocked popup without losing the panel", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  render(
    <PanelWindow title="Monitor">
      <Content />
    </PanelWindow>,
  );
  expect(screen.queryByText("PiP")).toBeNull();
  fireEvent.click(screen.getByText("Pop out"));
  await waitFor(() => {
    expect(screen.getByRole("alert")).toBeDefined();
  });
  expect(screen.getByTestId("content")).toBeDefined();
  expect(mounted).toHaveBeenCalledTimes(1);
});

it("uses the PiP API and closes the monitor when the panel is removed", async () => {
  const { child, close } = childWindow();
  const requestWindow = vi.fn().mockResolvedValue(child);
  vi.stubGlobal("documentPictureInPicture", { requestWindow });
  const view = render(
    <PanelWindow title="Monitor">
      <Content />
    </PanelWindow>,
  );
  fireEvent.click(screen.getByText("PiP"));
  await waitFor(() => {
    expect(child.document.querySelector('[data-testid="content"]')).not.toBeNull();
  });
  expect(requestWindow).toHaveBeenCalledWith({ width: 800, height: 600 });
  view.unmount();
  expect(close).toHaveBeenCalledOnce();
});

it("closes a PiP request that resolves after its panel was removed", async () => {
  const { child, close } = childWindow();
  let resolve!: (target: Window) => void;
  vi.stubGlobal("documentPictureInPicture", {
    requestWindow: async () =>
      await new Promise<Window>((done) => {
        resolve = done;
      }),
  });
  const view = render(
    <PanelWindow title="Monitor">
      <Content />
    </PanelWindow>,
  );
  fireEvent.click(screen.getByText("PiP"));
  view.unmount();
  await act(async () => {
    resolve(child);
  });
  expect(close).toHaveBeenCalledOnce();
});

it("forwards app shortcuts while preserving text input in the monitor", async () => {
  const { child } = childWindow();
  vi.spyOn(window, "open").mockReturnValue(child);
  const key = vi.fn((event: KeyboardEvent) => {
    event.preventDefault();
  });
  document.addEventListener("keydown", key);
  const view = render(
    <PanelWindow title="Monitor">
      <Content />
    </PanelWindow>,
  );
  fireEvent.click(screen.getByText("Pop out"));
  await waitFor(() => {
    expect(child.document.querySelector('[data-testid="content"]')).not.toBeNull();
  });
  const event = new KeyboardEvent("keydown", { key: " ", cancelable: true });
  child.document.dispatchEvent(event);
  expect(key).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
  const input = child.document.createElement("input");
  child.document.body.appendChild(input);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  expect(key).toHaveBeenCalledOnce();
  document.removeEventListener("keydown", key);
  view.unmount();
});

it("keeps several nested views in one monitor", async () => {
  const { child } = childWindow();
  const open = vi.spyOn(window, "open").mockReturnValue(child);
  render(
    <PanelWindow title="Views">
      <Content />
      <PanelWindow title="Nested">
        <div data-testid="nested">Nested view</div>
      </PanelWindow>
    </PanelWindow>,
  );
  fireEvent.click(screen.getByText("Pop out"));
  await waitFor(() => {
    expect(child.document.querySelector('[data-testid="nested"]')).not.toBeNull();
  });
  expect(within(child.document.body).getByText("Nested view")).toBeDefined();
  expect(open).toHaveBeenCalledOnce();
});
