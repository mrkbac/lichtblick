/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";

import LayoutManagerContext from "@lichtblick/suite-base/context/LayoutManagerContext";
import { ILayoutManager } from "@lichtblick/suite-base/services/ILayoutManager";
import { Layout, LayoutPermission } from "@lichtblick/suite-base/services/ILayoutStorage";
import { UserScripts } from "@lichtblick/suite-base/types/panels";

import { useTrustedUserScripts } from "./useTrustedUserScripts";

const scripts: UserScripts = { a: { name: "Speed", sourceCode: "export default () => 1;" } };
const changed: UserScripts = { a: { name: "Speed", sourceCode: "export default () => 2;" } };

function setup(permission: LayoutPermission) {
  const layoutManager = {
    getLayout: async (id: string) => ({ id, permission }) as unknown as Layout,
  } as unknown as ILayoutManager;
  type Props = { userScripts: UserScripts; edited: boolean };
  const hook = renderHook(
    ({ userScripts, edited }: Props) =>
      useTrustedUserScripts({ layoutId: "layout-1", userScripts, edited }),
    {
      initialProps: { userScripts: scripts, edited: false },
      wrapper: ({ children }) => (
        <LayoutManagerContext.Provider value={layoutManager}>
          {children}
        </LayoutManagerContext.Provider>
      ),
    },
  );
  // The hook only returns the dialog element; render it to click its buttons.
  const showPrompt = () => render(<>{hook.result.current.prompt}</>);
  return { hook, showPrompt };
}

// jsdom has no WebCrypto; the browser does on secure origins.
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

describe("useTrustedUserScripts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("runs scripts of local layouts without asking", async () => {
    const { hook } = setup("CREATOR_WRITE");
    await waitFor(() => {
      expect(hook.result.current.scripts).toBe(scripts);
    });
    expect(hook.result.current.prompt).toBeUndefined();
  });

  it("asks before running scripts of a shared layout and remembers the answer", async () => {
    const { hook, showPrompt } = setup("ORG_WRITE");
    await waitFor(() => {
      expect(hook.result.current.prompt).toBeDefined();
    });
    expect(hook.result.current.scripts).toEqual({});

    showPrompt();
    await userEvent.click(screen.getByRole("button", { name: "Run scripts" }));
    expect(hook.result.current.scripts).toBe(scripts);

    // After a reload the same scripts run without asking again.
    const reloaded = setup("ORG_WRITE");
    await waitFor(() => {
      expect(reloaded.hook.result.current.scripts).toBe(scripts);
    });
    expect(reloaded.hook.result.current.prompt).toBeUndefined();
  });

  it("asks again when someone else changed the scripts, but not for the user's own edits", async () => {
    const { hook, showPrompt } = setup("ORG_WRITE");
    await waitFor(() => {
      expect(hook.result.current.prompt).toBeDefined();
    });
    showPrompt();
    await userEvent.click(screen.getByRole("button", { name: "Run scripts" }));

    // Own edit: the layout has unsaved changes.
    hook.rerender({ userScripts: changed, edited: true });
    await waitFor(() => {
      expect(hook.result.current.scripts).toBe(changed);
    });

    // Changed on the server: no local edits.
    const remote = { a: { name: "Speed", sourceCode: "steal()" } };
    hook.rerender({ userScripts: remote, edited: false });
    await waitFor(() => {
      expect(hook.result.current.prompt).toBeDefined();
    });
    expect(hook.result.current.scripts).toEqual({});
  });

  it("keeps scripts off after Don't run", async () => {
    const { hook, showPrompt } = setup("ORG_READ");
    await waitFor(() => {
      expect(hook.result.current.prompt).toBeDefined();
    });
    showPrompt();
    await userEvent.click(screen.getByRole("button", { name: "Don’t run" }));
    expect(hook.result.current.prompt).toBeUndefined();
    expect(hook.result.current.scripts).toEqual({});
  });
});
