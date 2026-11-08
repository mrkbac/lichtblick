/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Dialog, Menu, MenuItem } from "@mui/material";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createDockview } from "dockview-react";
import { createContext, useContext, useEffect, useState } from "react";

import { DockPanelContext } from "./DockPanelContext";
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
  // Given
  const { child, close } = childWindow();
  vi.spyOn(window, "open").mockReturnValue(child);
  render(
    <SharedContext.Provider value="same connection">
      <PanelWindow title="Monitor">
        <Content />
      </PanelWindow>
    </SharedContext.Provider>,
  );
  // When
  fireEvent.click(screen.getByText("Pop out"));
  // Then
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
  // Given
  vi.spyOn(window, "open").mockReturnValue(null);
  render(
    <PanelWindow title="Monitor">
      <Content />
    </PanelWindow>,
  );
  expect(screen.queryByText("PiP")).toBeNull();
  // When
  fireEvent.click(screen.getByText("Pop out"));
  // Then
  await waitFor(() => {
    expect(screen.getByRole("alert")).toBeDefined();
  });
  expect(screen.getByTestId("content")).toBeDefined();
  expect(mounted).toHaveBeenCalledTimes(1);
});

it("uses the PiP API and closes the monitor when the panel is removed", async () => {
  // Given
  const { child, close } = childWindow();
  const requestWindow = vi.fn().mockResolvedValue(child);
  vi.stubGlobal("documentPictureInPicture", { requestWindow });
  const view = render(
    <PanelWindow title="Monitor">
      <Content />
    </PanelWindow>,
  );
  // When
  fireEvent.click(screen.getByText("PiP"));
  // Then
  await waitFor(() => {
    expect(child.document.querySelector('[data-testid="content"]')).not.toBeNull();
  });
  expect(requestWindow).toHaveBeenCalledWith({ width: 800, height: 600 });
  view.unmount();
  expect(close).toHaveBeenCalledOnce();
});

it("closes a PiP request that resolves after its panel was removed", async () => {
  // Given
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
  // When
  fireEvent.click(screen.getByText("PiP"));
  view.unmount();
  await act(async () => {
    resolve(child);
  });
  expect(close).toHaveBeenCalledOnce();
});

it("forwards app shortcuts while preserving text input in the monitor", async () => {
  // Given
  const { child } = childWindow();
  vi.spyOn(window, "open").mockReturnValue(child);
  const key = vi.fn((event: KeyboardEvent) => {
    event.preventDefault();
  });
  const controller = new AbortController();
  document.addEventListener("keydown", key, { signal: controller.signal });
  try {
    const view = render(
      <PanelWindow title="Monitor">
        <Content />
      </PanelWindow>,
    );
    // When
    fireEvent.click(screen.getByText("Pop out"));
    // Then
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
    view.unmount();
  } finally {
    controller.abort();
  }
});

it("keeps several nested views in one monitor", async () => {
  // Given
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
  // When
  fireEvent.click(screen.getByText("Pop out"));
  // Then
  await waitFor(() => {
    expect(child.document.querySelector('[data-testid="nested"]')).not.toBeNull();
  });
  expect(within(child.document.body).getByText("Nested view")).toBeDefined();
  expect(open).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "releases a popped-out panel's group and restores its tabs (stacked: %s)",
  async (stacked) => {
    // Given
    const { child } = childWindow();
    vi.spyOn(window, "open").mockReturnValue(child);
    const element = document.createElement("div");
    document.body.appendChild(element);
    const layout = createDockview(element, {
      createComponent: () => ({ element: document.createElement("div"), init: () => {} }),
      defaultRenderer: "always",
    });
    const panel = layout.addPanel({ id: "monitor", component: "content" });
    const sibling = layout.addPanel({
      id: "sibling",
      component: "content",
      position: { referencePanel: "monitor", direction: stacked ? "within" : "right" },
    });
    layout.layout(1000, 700);
    const originalGroup = panel.group;
    const view = render(
      <DockPanelContext.Provider value={{ api: panel.api, containerApi: layout }}>
        <PanelWindow title="Monitor">
          <Content />
        </PanelWindow>
      </DockPanelContext.Provider>,
    );
    try {
      // When
      fireEvent.click(screen.getByText("Pop out"));
      // Then
      await waitFor(() => {
        expect(panel.group.api.isVisible).toBe(false);
      });
      expect(sibling.group.api.isVisible).toBe(true);
      expect(sibling.group.width).toBe(1000);
      expect(layout.panels.map((item) => item.id).sort()).toEqual(["monitor", "sibling"]);
      expect(screen.queryByText("Show panel window")).toBeNull();
      // When the window closes, the original tab stack and layout return.
      fireEvent.click(within(child.document.body).getByText("Return"));
      // Then
      await waitFor(() => {
        expect(panel.group).toBe(originalGroup);
      });
      expect(panel.group.api.isVisible).toBe(true);
      expect(sibling.group.api.isVisible).toBe(true);
      expect(originalGroup.panels.map((item) => item.id)).toEqual(
        stacked ? ["monitor", "sibling"] : ["monitor"],
      );
    } finally {
      view.unmount();
      layout.dispose();
      element.remove();
    }
  },
);

it("can retry after window initialization fails before the close handlers are attached", async () => {
  // Given
  const { child, close } = childWindow();
  const open = vi.spyOn(window, "open").mockReturnValue(child);
  vi.spyOn(child.document, "title", "set").mockImplementationOnce(() => {
    throw new Error("Initialization failed");
  });
  render(
    <PanelWindow title="Monitor">
      <Content />
    </PanelWindow>,
  );
  // When
  fireEvent.click(screen.getByText("Pop out"));
  // Then
  await waitFor(() => {
    expect(screen.getByRole("alert")).toBeDefined();
  });
  expect(close).toHaveBeenCalledOnce();
  expect(screen.getByTestId("content")).toBeDefined();
  // When
  fireEvent.click(screen.getByText("Pop out"));
  // Then
  await waitFor(() => {
    expect(child.document.querySelector('[data-testid="content"]')).not.toBeNull();
  });
  expect(open).toHaveBeenCalledTimes(2);
});

it.each(["first", "second"] as const)(
  "reveals returned stacked panels when the %s window closes first",
  async (order) => {
    // Given two stacked panels that both move into separate windows
    const first = childWindow();
    const second = childWindow();
    vi.spyOn(window, "open").mockReturnValueOnce(first.child).mockReturnValueOnce(second.child);
    const element = document.createElement("div");
    document.body.appendChild(element);
    const layout = createDockview(element, {
      createComponent: () => ({ element: document.createElement("div"), init: () => {} }),
      defaultRenderer: "always",
    });
    const a = layout.addPanel({ id: "a", component: "content" });
    const b = layout.addPanel({
      id: "b",
      component: "content",
      position: { referencePanel: "a", direction: "within" },
    });
    layout.layout(1000, 700);
    const view = render(
      <>
        <DockPanelContext.Provider value={{ api: a.api, containerApi: layout }}>
          <PanelWindow title="A">
            <Content />
          </PanelWindow>
        </DockPanelContext.Provider>
        <DockPanelContext.Provider value={{ api: b.api, containerApi: layout }}>
          <PanelWindow title="B">
            <Content />
          </PanelWindow>
        </DockPanelContext.Provider>
      </>,
    );
    try {
      fireEvent.click(screen.getAllByText("Pop out")[0]!);
      await waitFor(() => {
        expect(a.group.api.isVisible).toBe(false);
      });
      fireEvent.click(screen.getByText("Pop out"));
      await waitFor(() => {
        expect(b.group.api.isVisible).toBe(false);
      });
      // When the first window closes, its panel is immediately visible again
      act(() => {
        (order === "first" ? first.close : second.close)();
      });
      // Then it stays visible after the remaining window closes too
      await waitFor(() => {
        expect((order === "first" ? a : b).group.api.isVisible).toBe(true);
      });
      act(() => {
        (order === "first" ? second.close : first.close)();
      });
      await waitFor(() => {
        expect(a.group).toBe(b.group);
      });
      expect(a.group.api.isVisible).toBe(true);
      expect(a.group.panels.map((panel) => panel.id).sort()).toEqual(["a", "b"]);
    } finally {
      view.unmount();
      layout.dispose();
      element.remove();
    }
  },
);

it.each(["default", "explicit", "anchored"] as const)(
  "keeps %s modal containers in their intended document",
  async (mode) => {
    // Given panel controls rendered in a separate window
    const { child } = childWindow();
    vi.spyOn(window, "open").mockReturnValue(child);
    function Controls() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            onClick={() => {
              setOpen(true);
            }}
          >
            Open dialog
          </button>
          {mode === "anchored" ? (
            <Menu open={open} anchorEl={document.body}>
              <MenuItem>Anchored item</MenuItem>
            </Menu>
          ) : (
            <Dialog open={open} container={mode === "explicit" ? document.body : undefined}>
              <span>Window dialog</span>
            </Dialog>
          )}
        </>
      );
    }
    const view = render(
      <PanelWindow title="Monitor">
        <Content />
        <Controls />
      </PanelWindow>,
    );
    try {
      // When a dialog or anchored menu opens from that window
      fireEvent.click(screen.getByText("Pop out"));
      await waitFor(() => {
        expect(within(child.document.body).getByText("Open dialog")).toBeDefined();
      });
      fireEvent.click(within(child.document.body).getByText("Open dialog"));
      // Then defaults use the child document, while explicit containers and anchors keep their own
      const expectedDocument = mode === "default" ? child.document : document;
      await waitFor(() => {
        expect(
          within(expectedDocument.body).getByText(
            mode === "anchored" ? "Anchored item" : "Window dialog",
          ),
        ).toBeDefined();
      });
      expect(
        (mode === "default" ? document : child.document).querySelector(
          mode === "anchored" ? '[role="menu"]' : '[role="dialog"]',
        ),
      ).toBeNull();
    } finally {
      view.unmount();
    }
  },
);
