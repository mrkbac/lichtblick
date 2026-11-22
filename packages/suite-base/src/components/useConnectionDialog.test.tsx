/** @jest-environment jsdom */
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";

import type { IDataSourceFactory } from "@lichtblick/suite-base/context/PlayerSelectionContext";

import { useConnectionDialog } from "./useConnectionDialog";

type DialogProps = React.ComponentProps<NonNullable<IDataSourceFactory["ConnectionDialog"]>>;

describe("useConnectionDialog", () => {
  it("disposes a late backend from a cancelled selection and hands the new backend to the caller", async () => {
    const { result } = renderHook(useConnectionDialog);
    const Dialog = () => <div />;
    let first!: ReturnType<typeof result.current.prompt>;
    act(() => {
      first = result.current.prompt(Dialog);
    });
    const stale = result.current.dialog!.props as DialogProps;
    act(() => {
      stale.onCancel();
    });
    expect(await first).toBeUndefined();

    let second!: typeof first;
    act(() => {
      second = result.current.prompt(Dialog, "ws://example:8765");
    });
    const current = result.current.dialog!.props as DialogProps;
    const expired = { open: vi.fn(), dispose: vi.fn() };
    act(() => {
      stale.onConnect("ws://old", expired);
    });
    expect(expired.dispose).toHaveBeenCalledOnce();
    expect(current.initialUrl).toBe("ws://example:8765");
    const transport = { open: vi.fn(), dispose: vi.fn() };
    act(() => {
      current.onConnect(current.initialUrl!, transport);
    });
    expect(await second).toEqual({ url: "ws://example:8765", transport });
    expect(transport.dispose).not.toHaveBeenCalled();
    expect(result.current.dialog).toBeUndefined();
  });

  it("settles pending selection when its manager unmounts", async () => {
    const { result, unmount } = renderHook(useConnectionDialog);
    let selection!: ReturnType<typeof result.current.prompt>;
    act(() => {
      selection = result.current.prompt(() => <div />);
    });
    unmount();
    expect(await selection).toBeUndefined();
  });
});
