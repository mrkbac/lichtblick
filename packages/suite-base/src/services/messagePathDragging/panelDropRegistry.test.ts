// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  DraggedMessagePath,
  MessagePathDropConfig,
} from "@lichtblick/suite-base/components/PanelExtensionAdapter";

import {
  clearPanelDrop,
  dropOnFirstAcceptingPanel,
  queuePanelDrop,
  setPanelDropConfig,
} from "./panelDropRegistry";

const paths: DraggedMessagePath[] = [
  {
    path: "/foo",
    rootSchemaName: "foo/Bar",
    isTopic: true,
    isLeaf: false,
    topicName: "/foo",
  },
];

function makeConfig({ canDrop }: { canDrop: boolean }): MessagePathDropConfig {
  return { getDropStatus: () => ({ canDrop }), handleDrop: vi.fn() };
}

describe("panelDropRegistry", () => {
  afterEach(() => {
    ["a", "b"].forEach(clearPanelDrop);
  });

  it("drops onto the first panel that accepts the paths", () => {
    const rejecting = makeConfig({ canDrop: false });
    const accepting = makeConfig({ canDrop: true });
    setPanelDropConfig("a", rejecting);
    setPanelDropConfig("b", accepting);

    expect(dropOnFirstAcceptingPanel(["a", "b"], paths)).toBe("b");
    expect(rejecting.handleDrop).not.toHaveBeenCalled();
    expect(accepting.handleDrop).toHaveBeenCalledWith(paths);
  });

  it("returns undefined when no panel accepts the paths", () => {
    setPanelDropConfig("a", makeConfig({ canDrop: false }));
    expect(dropOnFirstAcceptingPanel(["a", "missing"], paths)).toBeUndefined();
  });

  it("delivers a queued drop once the panel registers an accepting config", () => {
    queuePanelDrop("a", paths);
    const rejecting = makeConfig({ canDrop: false });
    setPanelDropConfig("a", rejecting);
    expect(rejecting.handleDrop).not.toHaveBeenCalled();

    const accepting = makeConfig({ canDrop: true });
    setPanelDropConfig("a", accepting);
    setPanelDropConfig("a", accepting);
    expect(accepting.handleDrop).toHaveBeenCalledTimes(1);
  });
});
