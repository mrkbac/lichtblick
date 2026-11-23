/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";

import { SettingsTreeAction, SettingsTreeActionReorder } from "@lichtblick/suite";
import { DEFAULT_PLOT_PATH } from "@lichtblick/suite-base/panels/Plot/constants";
import usePlotPanelSettings, {
  handleAddReferenceLineAction,
  handleAddSeriesAction,
  handleDeleteSeriesAction,
  handleUpdateAction,
} from "@lichtblick/suite-base/panels/Plot/hooks/usePlotPanelSettings";
import { HandleUpdateAction } from "@lichtblick/suite-base/panels/Plot/types";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import PlotBuilder from "@lichtblick/suite-base/testing/builders/PlotBuilder";
import { lineColors } from "@lichtblick/suite-base/util/plotColors";
import { BasicBuilder } from "@lichtblick/test-builders";

vi.mock("@lichtblick/suite-base/providers/PanelStateContextProvider", () => ({
  usePanelSettingsTreeUpdate: vi.fn(() => vi.fn()),
}));

describe("handleUpdateAction", () => {
  it("should update path", () => {
    const initialConfig = PlotBuilder.config({ paths: [] });
    const input: HandleUpdateAction = {
      draft: structuredClone(initialConfig),
      path: ["paths", "0", BasicBuilder.string()],
      value: BasicBuilder.string(),
    };

    handleUpdateAction(input);

    expect(input.draft.paths[0]).toEqual({ ...DEFAULT_PLOT_PATH, [input.path[2]!]: input.value });
  });

  it("should update path when has visible", () => {
    const initialConfig = PlotBuilder.config({ paths: [] });
    const input: HandleUpdateAction = {
      draft: structuredClone(initialConfig),
      path: ["paths", "0", "visible"],
      value: BasicBuilder.boolean(),
    };

    handleUpdateAction(input);

    expect(input.draft.paths[0]).toEqual({ ...DEFAULT_PLOT_PATH, enabled: input.value });
  });

  it("should update legend", () => {
    const initialConfig = PlotBuilder.config({
      paths: [],
      showLegend: false,
    });
    const input: HandleUpdateAction = {
      draft: structuredClone(initialConfig),
      path: ["legend", "legendDisplay"],
      value: BasicBuilder.string(),
    };

    handleUpdateAction(input);

    expect(input.draft.legendDisplay).toBe(input.value);
    expect(input.draft.showLegend).toBe(true);
  });

  it("should update xAxisPath", () => {
    const initialConfig = PlotBuilder.config({ paths: [] });
    const input: HandleUpdateAction = {
      draft: structuredClone(initialConfig),
      path: ["xAxis", "xAxisPath"],
      value: BasicBuilder.string(),
    };

    handleUpdateAction(input);

    expect(input.draft.xAxisPath).toEqual(
      expect.objectContaining({
        value: input.value,
      }),
    );
  });

  it("should update minXValue and maxXValue to undefined", () => {
    const initialConfig = PlotBuilder.config({ paths: [] });
    const input: HandleUpdateAction = {
      draft: structuredClone(initialConfig),
      path: [BasicBuilder.string(), "followingViewWidth"],
      value: BasicBuilder.string(),
    };

    handleUpdateAction(input);

    expect(input.draft.minXValue).toBeUndefined();
    expect(input.draft.maxXValue).toBeUndefined();
  });

  it.each(["minXValue", "maxXValue"])(
    "should update followingViewWidth when path is minXValue or maxXValue",
    (path1) => {
      const initialConfig = PlotBuilder.config({ paths: [] });
      const input: HandleUpdateAction = {
        draft: structuredClone(initialConfig),
        path: [BasicBuilder.string(), path1],
        value: BasicBuilder.string(),
      };

      handleUpdateAction(input);

      expect(input.draft.followingViewWidth).toBeUndefined();
    },
  );
});

describe("handleAddSeriesAction", () => {
  it.each([{ paths: PlotBuilder.paths() }, { paths: [] }])(
    "should add series with explicit color",
    ({ paths }) => {
      const initialConfig = PlotBuilder.config({ paths });
      const input = { draft: structuredClone(initialConfig) };
      const initialLength = paths.length;

      handleAddSeriesAction(input.draft);

      // Verify a new series was added
      expect(input.draft.paths).toHaveLength(initialLength === 0 ? 2 : initialLength + 1);

      // Verify the added series has the expected structure with explicit color
      const addedSeries = input.draft.paths[input.draft.paths.length - 1];
      expect(addedSeries).toMatchObject({
        ...DEFAULT_PLOT_PATH,
        color: expect.any(String),
      });
    },
  );
});

describe("handleAddReferenceLineAction", () => {
  it("adds a horizontal line at 0 with its own color", () => {
    const input = { draft: PlotBuilder.config({ paths: [] }) };

    handleAddReferenceLineAction(input.draft);

    expect(input.draft.paths).toEqual([{ ...DEFAULT_PLOT_PATH, value: "0", color: lineColors[0] }]);
  });
});

describe("handleDeleteSeriesAction", () => {
  it("should delete a serie", () => {
    const initialConfig = PlotBuilder.config();
    const input = { draft: structuredClone(initialConfig) };

    handleDeleteSeriesAction(input.draft, 1);

    expect(input.draft.paths).toHaveLength(initialConfig.paths.length - 1);
  });
});

describe("usePlotPanelSettings", () => {
  const saveConfig = vi.fn();
  const updatePanelSettingsTree = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    (usePanelSettingsTreeUpdate as Mock).mockReturnValue(updatePanelSettingsTree);
  });

  it.each<SettingsTreeAction>([
    {
      action: "update",
      payload: { path: [], value: "", input: "string" },
    },
    {
      action: "perform-node-action",
      payload: { path: [], id: "add-series" },
    },
    {
      action: "perform-node-action",
      payload: { path: [], id: "delete-series" },
    },
  ])("should call saveConfig to update settings tree", (action: SettingsTreeAction) => {
    const config = PlotBuilder.config();
    const focusedPath = undefined;

    renderHook(() => {
      usePlotPanelSettings(config, saveConfig, focusedPath);
    });

    expect(usePanelSettingsTreeUpdate).toHaveBeenCalled();

    const actionHandler = updatePanelSettingsTree.mock.calls[0]![0].actionHandler;
    act(() => {
      actionHandler(action);
    });

    expect(saveConfig).toHaveBeenCalledWith(expect.any(Function));
  });

  describe("reorder-node action (drag and drop)", () => {
    it.each([
      { sourceIndex: 0, targetIndex: 2, description: "first to last" },
      { sourceIndex: 2, targetIndex: 0, description: "last to first" },
      { sourceIndex: 0, targetIndex: 1, description: "first to middle" },
      { sourceIndex: 1, targetIndex: 2, description: "middle to last" },
    ])(
      "should call saveConfig with reorder action when moving $description",
      ({ sourceIndex, targetIndex }) => {
        // Given: A configuration with three series
        const config = PlotBuilder.config();

        renderHook(() => {
          usePlotPanelSettings(config, saveConfig, undefined);
        });

        const actionHandler = updatePanelSettingsTree.mock.calls[0]![0].actionHandler;

        // When: Triggering reorder-node action
        const action: SettingsTreeActionReorder = {
          action: "reorder-node",
          payload: {
            path: ["paths", String(sourceIndex)],
            targetPath: ["paths", String(targetIndex)],
          },
        };

        act(() => {
          actionHandler(action);
        });

        // Then: saveConfig should be called with the producer function
        expect(saveConfig).toHaveBeenCalledWith(expect.any(Function));
      },
    );
  });
});
