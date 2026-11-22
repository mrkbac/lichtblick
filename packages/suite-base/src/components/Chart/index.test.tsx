/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, waitFor } from "@testing-library/react";
import { Component, ReactNode } from "react";

import Chart from "./index";

// jsdom has no OffscreenCanvas, so the chart talks to an in-process mux; stand in for it.
const mux = vi.hoisted(() => ({ initialize: vi.fn(), update: vi.fn(), destroy: vi.fn() }));
vi.mock("./worker/ChartJsMux", () => ({
  default: class {
    public initialize = mux.initialize;
    public update = mux.update;
    public destroy = mux.destroy;
  },
}));

const scale = (max: number) => ({ left: 0, right: 100, min: 0, max, pixelMin: 0, pixelMax: 100 });

class CatchError extends Component<{ children: ReactNode; onError: (error: Error) => void }> {
  public override state = { failed: false };
  public static getDerivedStateFromError() {
    return { failed: true };
  }
  public override componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  public override render(): ReactNode {
    return this.state.failed ? <></> : this.props.children;
  }
}

function renderChart(props: Partial<React.ComponentProps<typeof Chart>> = {}) {
  return render(
    <Chart
      type="scatter"
      width={100}
      height={100}
      options={{}}
      isBoundsReset={false}
      data={{ datasets: [] }}
      {...props}
    />,
  );
}

describe("Chart", () => {
  beforeEach(() => {
    mux.initialize.mockReset();
    mux.update.mockReset();
    mux.destroy.mockReset().mockResolvedValue(undefined);
  });

  it("publishes scales from the first update, not the placeholder bounds of initialize", async () => {
    mux.initialize.mockResolvedValue({ x: scale(1), y: scale(1) });
    mux.update.mockResolvedValue({ x: scale(30), y: scale(1) });
    const onScalesUpdate = vi.fn();

    renderChart({ onScalesUpdate });

    await waitFor(() => {
      expect(onScalesUpdate).toHaveBeenCalled();
    });
    for (const [scales] of onScalesUpdate.mock.calls) {
      expect(scales).toMatchObject({ x: { max: 30 } });
    }
  });

  it("balances render callbacks and surfaces the error when initialize fails", async () => {
    mux.initialize.mockRejectedValue(new Error("no context"));
    const onStartRender = vi.fn();
    const onFinishRender = vi.fn();
    const onError = vi.fn();

    render(
      <CatchError onError={onError}>
        <Chart
          type="scatter"
          width={100}
          height={100}
          options={{}}
          isBoundsReset={false}
          data={{ datasets: [] }}
          onStartRender={onStartRender}
          onFinishRender={onFinishRender}
        />
      </CatchError>,
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "no context" }));
    });
    expect(onFinishRender).toHaveBeenCalledTimes(onStartRender.mock.calls.length);
    expect(mux.update).not.toHaveBeenCalled();
    // React and the chart log the failure; that is expected here.
    (console.error as unknown as { mockClear: () => void }).mockClear();
    (console.warn as unknown as { mockClear: () => void }).mockClear();
  });
});
