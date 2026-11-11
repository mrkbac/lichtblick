/** @vitest-environment jsdom */
/* oxlint-disable @lichtblick/license-header -- New fork files must not claim BMW copyright. */
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";

import { Stats } from "./Stats";

const mocks = vi.hoisted(() => ({
  listeners: [] as ((
    event: undefined,
    renderer: {
      gl: {
        info: {
          render: { calls: number; triangles: number };
          memory: { textures: number; geometries: number };
        };
      };
    },
  ) => void)[],
  panels: [] as { update: ReturnType<typeof vi.fn> }[],
}));

vi.mock("./RendererContext", () => ({
  useRendererEvent: (_event: string, listener: (typeof mocks.listeners)[number]) => {
    mocks.listeners.push(listener);
  },
}));
vi.mock("stats.js", () => ({
  default: class {
    public dom = document.createElement("div");
    public static Panel = class {
      public update = vi.fn();
      public constructor() {
        mocks.panels.push(this);
      }
    };
    public addPanel(panel: { update: ReturnType<typeof vi.fn> }) {
      return panel;
    }
    public showPanel() {}
    public update() {}
  },
}));

beforeEach(() => {
  mocks.listeners.length = 0;
  mocks.panels.length = 0;
});

it("updates renderer counters independently for each mounted monitor and removes its DOM", () => {
  const first = render(<Stats />);
  const second = render(<Stats />);
  const renderer = {
    gl: { info: { render: { calls: 5, triangles: 10 }, memory: { textures: 2, geometries: 3 } } },
  };
  mocks.listeners[0]!(undefined, renderer);
  expect(mocks.panels[0]!.update).toHaveBeenLastCalledWith(5, 5);
  expect(mocks.panels[4]!.update).not.toHaveBeenCalled();
  renderer.gl.info.render.calls = 1;
  mocks.listeners[0]!(undefined, renderer);
  mocks.listeners[1]!(undefined, renderer);
  expect(mocks.panels[0]!.update).toHaveBeenLastCalledWith(1, 5);
  expect(mocks.panels[4]!.update).toHaveBeenLastCalledWith(1, 1);
  const node = first.container.firstElementChild!.firstElementChild!;
  first.unmount();
  expect(node.isConnected).toBe(false);
  expect(second.container.firstElementChild!.childElementCount).toBe(1);
});
