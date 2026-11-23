/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import "@testing-library/jest-dom/vitest";

import { Immutable, SettingsTreeAction, SettingsTreeNode } from "@lichtblick/suite";
import {
  dropEdgeAt,
  handleDropNode,
  NodeEditor,
  reorderChildrenAction,
} from "@lichtblick/suite-base/components/SettingsTreeEditor/NodeEditor";
import {
  FieldEditorProps,
  NodeEditorProps,
  SelectVisibilityFilterValue,
} from "@lichtblick/suite-base/components/SettingsTreeEditor/types";
import { BasicBuilder } from "@lichtblick/test-builders";

// Keyed by the last path segment (e.g. "visibilityFilter", "textFilter") since multiple
// FieldEditor mocks can be rendered at once for a single NodeEditor.
const capturedActionHandlers: Record<string, (action: SettingsTreeAction) => void> = {};

vi.mock("@lichtblick/suite-base/components/SettingsTreeEditor/FieldEditor", () => ({
  FieldEditor: (props: FieldEditorProps) => {
    const key = props.path[props.path.length - 1] ?? "";
    capturedActionHandlers[key] = props.actionHandler;
    return <div data-testid={`FieldEditor-${key}`} />;
  },
}));

const changeVisibilityFilter = (visibility: SelectVisibilityFilterValue) => {
  capturedActionHandlers.visibilityFilter?.({
    action: "update",
    payload: { input: "select", value: visibility, path: ["topics", "visibilityFilter"] },
  });
};

const changeTextFilter = (value: string) => {
  capturedActionHandlers.textFilter?.({
    action: "update",
    payload: { input: "string", value, path: ["topics", "textFilter"] },
  });
};

function setupFn(propsOverride: Partial<NodeEditorProps> = {}) {
  const props: Readonly<NodeEditorProps> = {
    actionHandler: vi.fn(),
    path: BasicBuilder.strings({ count: 2 }),
    settings: {
      label: BasicBuilder.string(),
      reorderable: true,
    },
    focusedPath: [],
    ...propsOverride,
  };

  const ui: React.ReactElement = <NodeEditor {...props} />;

  return {
    ...render(ui),
    props,
  };
}

describe("handleDropNode", () => {
  it("calls actionHandler with reorder-node action", () => {
    // Given: A drop item and action handler
    const actionHandler = vi.fn();
    const sourcePath = [BasicBuilder.string(), BasicBuilder.string()];
    const targetPath = [BasicBuilder.string(), BasicBuilder.string()];
    const dragItem = { path: sourcePath };

    // When: handleDropNode is called
    handleDropNode(dragItem, targetPath, actionHandler);

    // Then: actionHandler is called with correct action
    expect(actionHandler).toHaveBeenCalledWith({
      action: "reorder-node",
      payload: {
        path: sourcePath,
        targetPath,
      },
    });
  });
});

describe("topic name tree", () => {
  it("compacts single-child paths and keeps filters when switching between tree and list", async () => {
    const user = userEvent.setup();
    setupFn({
      path: ["topics"],
      settings: {
        enableVisibilityFilter: true,
        enableTopicNameTree: true,
        topicQuickFilters: [
          { id: "pointClouds", label: "Point clouds", topics: ["/camera/front/points"] },
        ],
        children: {
          "/camera/front/image": { label: "/camera/front/image", visible: true },
          "/camera/front/points": { label: "/camera/front/points", visible: false },
          "/robot/state": { label: "/robot/state", visible: true },
        },
      },
    });

    const tree = screen.getByRole("button", { name: "Group topics by name" });
    await user.click(tree);
    expect(screen.getByText("/camera/front")).toBeInTheDocument();
    expect(screen.getByText("/robot/state")).toBeInTheDocument();
    expect(screen.queryByText("image")).not.toBeInTheDocument();

    const branch = screen.getByRole("button", { name: "/camera/front" });
    act(() => {
      branch.focus();
    });
    await user.keyboard("{Enter}");
    expect(screen.getByText("image")).toBeInTheDocument();

    const pointClouds = screen.getByRole("button", { name: "Point clouds" });
    await user.click(pointClouds);
    expect(pointClouds).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("image")).not.toBeInTheDocument();
    expect(screen.getByText("points")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hidden" }));
    await user.type(screen.getByRole("searchbox"), "/camera/front");
    expect(screen.queryByText("image")).not.toBeInTheDocument();
    expect(screen.getByText("points")).toBeInTheDocument();
    await user.click(tree);
    expect(screen.queryByText("/camera/front/image")).not.toBeInTheDocument();
    expect(screen.getByText("/camera/front/points")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("/camera/front");
    expect(pointClouds).toHaveAttribute("aria-pressed", "true");
  });

  it("reports mixed, hidden and shown states and toggles the entire branch using topic paths", async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn();
    const path = ["topics"];
    const settings = ({ image, points }: { image: boolean; points: boolean }) => ({
      enableVisibilityFilter: true,
      enableTopicNameTree: true,
      children: {
        "/camera/image": { visible: image },
        "/camera/points": { visible: points },
        "/robot/state": { visible: true },
      },
    });
    const { rerender } = setupFn({
      path,
      actionHandler,
      settings: settings({ image: true, points: false }),
    });
    await user.click(screen.getByRole("button", { name: "Group topics by name" }));
    expect(screen.queryByRole("group", { name: "Filter by topic type" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "points");
    const mixed = screen.getByRole("checkbox", { name: "Hide all topics in /camera" });
    expect(mixed).toBePartiallyChecked();
    await user.click(mixed);
    expect(actionHandler).toHaveBeenCalledExactlyOnceWith({
      action: "update",
      payload: { input: "boolean", path: ["topics", "/camera/image", "visible"], value: false },
    });

    rerender(
      <NodeEditor
        path={path}
        actionHandler={actionHandler}
        settings={settings({ image: false, points: false })}
      />,
    );
    const hidden = screen.getByRole("checkbox", { name: "Show all topics in /camera" });
    expect(hidden).not.toBeChecked();
    actionHandler.mockClear();
    await user.click(hidden);
    expect(actionHandler.mock.calls.map(([action]) => action.payload)).toEqual([
      { input: "boolean", path: ["topics", "/camera/image", "visible"], value: true },
      { input: "boolean", path: ["topics", "/camera/points", "visible"], value: true },
    ]);

    rerender(
      <NodeEditor
        path={path}
        actionHandler={actionHandler}
        settings={settings({ image: true, points: true })}
      />,
    );
    const shown = screen.getByRole("checkbox", { name: "Hide all topics in /camera" });
    expect(shown).toBeChecked();
    expect(shown).not.toBePartiallyChecked();
  });
});

describe("NodeEditor childNodes filtering", () => {
  const nodes = BasicBuilder.strings({ count: 3 }) as [string, string, string];
  const scrollIntoViewMock = vi.fn();

  const tree: Immutable<SettingsTreeNode> = {
    enableVisibilityFilter: true,
    children: {
      [nodes[0]]: { visible: true, label: nodes[0] },
      [nodes[1]]: {
        visible: false,
        label: nodes[1],
        error: BasicBuilder.string(),
        icon: "Clear",
        actions: [{ id: BasicBuilder.string(), type: "action", label: BasicBuilder.string() }],
      },
      [nodes[2]]: { label: nodes[2] }, // undefined visibility is always shown
    },
  };

  const renderComponent = async (overrides: Partial<NodeEditorProps> = {}) => {
    const props: NodeEditorProps = {
      actionHandler: vi.fn(),
      path: ["root"],
      settings: tree,
      focusedPath: [],
      ...overrides,
    };

    const ui: React.ReactElement = <NodeEditor {...props} />;

    return {
      ...render(ui),
      user: userEvent.setup(),
      props,
    };
  };

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  it("all nodes should be visible at start", async () => {
    await renderComponent();

    expect(screen.getByText(nodes[0])).toBeInTheDocument();
    expect(screen.getByText(nodes[1])).toBeInTheDocument();
    expect(screen.getByText(nodes[2])).toBeInTheDocument();
  });

  it("should list only the selected option filter", async () => {
    await renderComponent();

    expect(screen.getByText(nodes[0])).toBeInTheDocument();
    expect(screen.getByText(nodes[1])).toBeInTheDocument();
    expect(screen.getByText(nodes[2])).toBeInTheDocument();

    act(() => {
      changeVisibilityFilter("visible");
    });

    expect(screen.getByText(nodes[0])).toBeInTheDocument();
    expect(screen.queryByText(nodes[1])).not.toBeInTheDocument();
    expect(screen.getByText(nodes[2])).toBeInTheDocument();

    act(() => {
      changeVisibilityFilter("invisible");
    });

    expect(screen.queryByText(nodes[0])).not.toBeInTheDocument();
    expect(screen.getByText(nodes[1])).toBeInTheDocument();
    expect(screen.getByText(nodes[2])).toBeInTheDocument();

    act(() => {
      changeVisibilityFilter("all");
    });

    expect(screen.getByText(nodes[0])).toBeInTheDocument();
    expect(screen.getByText(nodes[1])).toBeInTheDocument();
    expect(screen.getByText(nodes[2])).toBeInTheDocument();
  });

  it("does not show the text filter field when enableVisibilityFilter is not set, even with children", async () => {
    const label = BasicBuilder.string();
    const childLabel = BasicBuilder.string();

    await renderComponent({
      settings: { label, children: { child1: { label: childLabel } } },
    });

    expect(screen.queryByTestId("FieldEditor-textFilter")).not.toBeInTheDocument();
  });

  it("shows the text filter field when enableVisibilityFilter is set and the node has children", async () => {
    await renderComponent();

    expect(screen.getByTestId("FieldEditor-textFilter")).toBeInTheDocument();
  });

  it("filters through the already visibility-filtered options when text filter is applied", async () => {
    await renderComponent();

    act(() => {
      changeVisibilityFilter("visible");
    });

    act(() => {
      changeTextFilter(nodes[2]);
    });

    // nodes[1] is excluded by the visibility filter, and nodes[0] doesn't match the text filter.
    expect(screen.queryByText(nodes[0])).not.toBeInTheDocument();
    expect(screen.queryByText(nodes[1])).not.toBeInTheDocument();
    expect(screen.getByText(nodes[2])).toBeInTheDocument();
  });

  it("recursively filters descendants by text, keeping ancestors of matches", async () => {
    const grandchildLabel = BasicBuilder.string();
    const matchingChildLabel = BasicBuilder.string();
    const nonMatchingChildLabel = BasicBuilder.string();

    const settings: Immutable<SettingsTreeNode> = {
      label: "root",
      enableVisibilityFilter: true,
      children: {
        branchA: {
          label: matchingChildLabel,
          children: {
            grandchild: { label: grandchildLabel },
          },
        },
        branchB: {
          label: nonMatchingChildLabel,
        },
      },
    };

    await renderComponent({ settings });

    act(() => {
      changeTextFilter(grandchildLabel);
    });

    expect(screen.getByText(matchingChildLabel)).toBeInTheDocument();
    expect(screen.getByText(grandchildLabel)).toBeInTheDocument();
    expect(screen.queryByText(nonMatchingChildLabel)).not.toBeInTheDocument();
  });

  it("calls actionHandler with toggled visibility", async () => {
    const label = BasicBuilder.string();

    const { props } = await renderComponent({ settings: { label, visible: true } });

    // Hidden until hover on fine-pointer devices (jsdom applies the media query).
    const toggle = screen.getByRole("checkbox", { hidden: true });
    fireEvent.click(toggle);

    expect(props.actionHandler).toHaveBeenCalledWith({
      action: "update",
      payload: {
        input: "boolean",
        path: ["root", "visible"],
        value: false,
      },
    });
  });

  it("should call scrollIntoView when node is focused", async () => {
    const path = BasicBuilder.strings({ count: 3 }) as [string, string, string];
    const label = BasicBuilder.string();

    await renderComponent({ path, settings: { label, visible: true }, focusedPath: path });

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("calls actionHandler to edit label", async () => {
    const label = BasicBuilder.string();

    const { props } = await renderComponent({
      settings: { label, visible: true, renamable: true },
    });

    fireEvent.click(screen.getByTitle("Rename"));

    const input = screen.getByRole("textbox");

    const newLabel = BasicBuilder.string();
    fireEvent.change(input, { target: { value: newLabel } });

    expect(props.actionHandler).toHaveBeenCalledWith({
      action: "update",
      payload: {
        path: ["root", "label"],
        input: "string",
        value: newLabel,
      },
    });
  });

  it.each(["{Enter}", "{Escape}"])("exits editing on %s", async (key: string) => {
    const user = userEvent.setup();
    const nodeLabel = BasicBuilder.string();

    await renderComponent({ settings: { label: nodeLabel, renamable: true } });

    await user.click(screen.getByTitle("Rename"));

    await user.keyboard(key);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(nodeLabel)).toBeInTheDocument();
  });

  it("exits editing mode when CheckIcon button is clicked", async () => {
    // Given: A renamable node in editing mode
    const nodeLabel = BasicBuilder.string();

    await renderComponent({ settings: { label: nodeLabel, renamable: true } });

    fireEvent.click(screen.getByTitle("Rename"));

    const textbox = screen.getByRole("textbox");
    expect(textbox).toBeInTheDocument();

    // When: The CheckIcon confirm button is clicked
    const confirmButton = screen.getByTestId("check-icon-button");
    fireEvent.click(confirmButton);

    // Then: Editing mode is exited
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(nodeLabel)).toBeInTheDocument();
  });

  it("stops event propagation when CheckIcon button is clicked", async () => {
    // Given: A renamable node in editing mode
    const nodeLabel = BasicBuilder.string();
    const stopPropagationSpy = vi.fn();

    await renderComponent({ settings: { label: nodeLabel, renamable: true } });

    fireEvent.click(screen.getByTitle("Rename"));

    // When: The CheckIcon button is clicked with event
    const confirmButton = screen.getByTestId("check-icon-button");

    const clickEvent = new MouseEvent("click", { bubbles: true });
    clickEvent.stopPropagation = stopPropagationSpy;

    fireEvent(confirmButton, clickEvent);

    // Then: Event propagation is stopped
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it("does not toggle open state when in editing mode", async () => {
    // Given: A renamable node with children in editing mode
    const nodeLabel = BasicBuilder.string();
    const childLabel = BasicBuilder.string();

    await renderComponent({
      settings: {
        label: nodeLabel,
        renamable: true,
        children: {
          child1: { label: childLabel },
        },
      },
    });

    // Enter editing mode
    fireEvent.click(screen.getByTitle("Rename"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // When: Clicking the toggle area while in editing mode
    const toggleArea = screen.getByTestId(`settings__nodeHeaderToggle__root`);
    fireEvent.click(toggleArea);

    // Then: Node remains expanded and still in editing mode
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText(childLabel)).toBeInTheDocument();
  });

  it("renders icon when icon is set and not a drag handle", async () => {
    // Given: A node with a non-drag-handle icon
    const nodeLabel = BasicBuilder.string();

    await renderComponent({
      settings: {
        label: nodeLabel,
        icon: "Clear",
      },
    });

    // Then: Icon should be rendered
    expect(screen.getByTestId("ClearIcon")).toBeInTheDocument();
  });

  it("renders drag handle icon for reorderable nodes", async () => {
    // Given: A reorderable node with DragHandle icon
    const nodeLabel = BasicBuilder.string();

    await renderComponent({
      settings: {
        label: nodeLabel,
        icon: "DragHandle",
        reorderable: true,
      },
    });

    // Drag handle icon is rendered as part of the component
    expect(screen.getByTestId("DragIndicatorIcon")).toBeInTheDocument();
  });

  it("toggles node open state when not editing", async () => {
    // Given: A node with children that is initially open
    const nodeLabel = BasicBuilder.string();
    const childLabel = BasicBuilder.string();

    await renderComponent({
      settings: {
        label: nodeLabel,
        children: {
          child1: { label: childLabel },
        },
      },
    });

    // Child should be visible initially (defaultOpen is true)
    expect(screen.getByText(childLabel)).toBeInTheDocument();

    // When: Clicking the toggle area
    const toggleArea = screen.getByTestId(`settings__nodeHeaderToggle__root`);
    fireEvent.click(toggleArea);

    // Then: Child is hidden
    expect(screen.queryByText(childLabel)).not.toBeInTheDocument();

    // When: Clicking the toggle area again
    fireEvent.click(toggleArea);

    // Then: Child is visible again
    expect(screen.getByText(childLabel)).toBeInTheDocument();
  });
});

describe("NodeEditor drag and drop functionality", () => {
  function setupMultipleNodes(
    nodes: Array<{ path: string[]; label: string; reorderable?: boolean }>,
    actionHandler = vi.fn(),
  ) {
    const ui: React.ReactElement = (
      <>
        {nodes.map(({ path, label, reorderable = true }) => (
          <NodeEditor
            key={path.join("-")}
            actionHandler={actionHandler}
            path={path}
            settings={{ label, reorderable }}
            focusedPath={[]}
          />
        ))}
      </>
    );

    return {
      ...render(ui),
      actionHandler,
    };
  }

  describe("drag behavior", () => {
    it("should show grab cursor and default opacity when node is reorderable", () => {
      // Given/When: A reorderable node is rendered
      const { container } = setupFn({
        settings: { label: BasicBuilder.string(), reorderable: true },
      });

      // Then: The node header should have grab cursor and opacity 1
      const nodeHeader = container.querySelector('[class*="nodeHeader"]');
      expect(nodeHeader).toHaveStyle({ cursor: "grab" });
      expect(nodeHeader).toHaveStyle({ opacity: "1" });
    });

    it("should not show grab cursor when node is not reorderable", () => {
      // Given/When: A non-reorderable node is rendered
      const { container } = setupFn({
        settings: { label: BasicBuilder.string(), reorderable: false },
      });

      // Then: The node header should not have grab cursor
      const nodeHeader = container.querySelector('[class*="nodeHeader"]');
      expect(nodeHeader).not.toHaveStyle({ cursor: "grab" });
    });
  });

  describe("drop behavior with sibling nodes", () => {
    it("should render multiple sibling nodes correctly for drag and drop", () => {
      // Given: Two sibling reorderable nodes under the same parent
      const sourceLabel = "Source Node";
      const targetLabel = "Target Node";

      // When: Both nodes are rendered
      const { container } = setupMultipleNodes([
        { path: ["topics", "node1"], label: sourceLabel },
        { path: ["topics", "node2"], label: targetLabel },
      ]);

      // Then: Both nodes should be rendered and draggable
      expect(screen.getByText(sourceLabel)).toBeInTheDocument();
      expect(screen.getByText(targetLabel)).toBeInTheDocument();

      const nodeHeaders = container.querySelectorAll('[draggable="true"]');
      expect(nodeHeaders).toHaveLength(2);
      expect(nodeHeaders[0]).toHaveStyle({ cursor: "grab" });
      expect(nodeHeaders[1]).toHaveStyle({ cursor: "grab" });
    });

    it("should not show grab cursor when target is not reorderable", () => {
      // Given: Source is reorderable, target is not
      const { container } = setupMultipleNodes([
        { path: ["topics", "node1"], label: "Draggable", reorderable: true },
        { path: ["topics", "node2"], label: "Not Draggable", reorderable: false },
      ]);

      // Then: Both nodes are rendered
      expect(screen.getByText("Draggable")).toBeInTheDocument();
      expect(screen.getByText("Not Draggable")).toBeInTheDocument();

      // Only the first node should be draggable
      const draggableNodes = container.querySelectorAll('[draggable="true"]');
      expect(draggableNodes).toHaveLength(1);
      expect(draggableNodes[0]).toHaveStyle({ cursor: "grab" });
    });
  });

  describe("depth validation", () => {
    it("should render top-level nodes but with grab cursor (depth validation is on canDrop)", () => {
      // Given: Top-level reorderable nodes (depth 1)
      const { container } = setupMultipleNodes([
        { path: ["topics"], label: "Topics" },
        { path: ["cameras"], label: "Cameras" },
      ]);

      // Then: Nodes are rendered (canDrop will prevent actual drop between them)
      expect(screen.getByText("Topics")).toBeInTheDocument();
      expect(screen.getByText("Cameras")).toBeInTheDocument();

      const nodeHeaders = container.querySelectorAll('[draggable="true"]');
      expect(nodeHeaders).toHaveLength(2);
    });

    it("should render nodes at different depths", () => {
      // Given: Nodes at different depths
      const { container } = setupMultipleNodes([
        { path: ["topics", "node1"], label: "Shallow Node" },
        { path: ["topics", "nested", "node2"], label: "Deep Node" },
      ]);

      // Then: Both nodes should be rendered
      expect(screen.getByText("Shallow Node")).toBeInTheDocument();
      expect(screen.getByText("Deep Node")).toBeInTheDocument();

      const nodeHeaders = container.querySelectorAll('[draggable="true"]');
      expect(nodeHeaders).toHaveLength(2);
    });
  });

  describe("drag events simulation", () => {
    it("should handle dragStart event on reorderable node", () => {
      // Given: A reorderable node
      const { container } = setupFn({
        path: ["topics", "node1"],
        settings: { label: "Draggable Node", reorderable: true },
      });

      const nodeHeader = container.querySelector('[class*="nodeHeader"]')!;

      // When: dragStart event is fired
      fireEvent.dragStart(nodeHeader, {
        dataTransfer: { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "move" },
      });

      // Then: The node should still be in the document
      expect(screen.getByText("Draggable Node")).toBeInTheDocument();
    });

    it("should handle dragOver and dragLeave events", () => {
      // Given: Two sibling reorderable nodes
      const { container } = setupMultipleNodes([
        { path: ["topics", "node1"], label: "Source" },
        { path: ["topics", "node2"], label: "Target" },
      ]);

      const nodeHeaders = container.querySelectorAll('[class*="nodeHeader"]');
      const targetNode = nodeHeaders[1]!;

      // When: dragOver and dragLeave events are fired
      fireEvent.dragOver(targetNode);
      fireEvent.dragLeave(targetNode);

      // Then: Both nodes should still be in the document
      expect(screen.getByText("Source")).toBeInTheDocument();
      expect(screen.getByText("Target")).toBeInTheDocument();
    });

    it("should handle drop event on valid sibling target", () => {
      // Given: Two sibling reorderable nodes with shared actionHandler
      const actionHandler = vi.fn();
      setupMultipleNodes(
        [
          { path: ["topics", "node1"], label: "Source" },
          { path: ["topics", "node2"], label: "Target" },
        ],
        actionHandler,
      );

      // Then: Nodes should be rendered
      expect(screen.getByText("Source")).toBeInTheDocument();
      expect(screen.getByText("Target")).toBeInTheDocument();

      // Note: the drop itself goes through native drag events, which jsdom does not fully support;
      // handleDropNode is tested on its own
    });
  });
});

describe("NodeEditor inline actions", () => {
  describe("inline action with icon", () => {
    it("should call actionHandler with perform-node-action when inline icon button is clicked", () => {
      // Given: A node with an inline action that has an icon
      const actionId = BasicBuilder.string();
      const actionLabel = BasicBuilder.string();
      const path = BasicBuilder.strings({ count: 2 });

      const { props, container } = setupFn({
        path,
        settings: {
          label: BasicBuilder.string(),
          actions: [
            {
              type: "action",
              id: actionId,
              label: actionLabel,
              icon: "Delete",
              display: "inline",
            },
          ],
        },
      });

      // When: The inline icon button is clicked
      const iconButton = container.querySelector('button[class*="actionButton"]')!;
      fireEvent.click(iconButton);

      // Then: The actionHandler should be called with perform-node-action
      expect(props.actionHandler).toHaveBeenCalledWith({
        action: "perform-node-action",
        payload: { id: actionId, path },
      });
    });

    it("should call actionHandler with perform-node-action for menu actions", () => {
      // Given: A node with a menu action (non-inline)
      const actionId = BasicBuilder.string();
      const actionLabel = BasicBuilder.string();
      const path = BasicBuilder.strings({ count: 2 });

      const { props } = setupFn({
        path,
        settings: {
          label: BasicBuilder.string(),
          actions: [
            {
              type: "action",
              id: actionId,
              label: actionLabel,
              display: "menu",
            },
          ],
        },
      });

      // When: The menu is opened and action is selected
      const menuButton = screen.getByRole("button", { name: /more/i });
      fireEvent.click(menuButton);

      const menuItem = screen.getByRole("menuitem", { name: actionLabel });
      fireEvent.click(menuItem);

      // Then: The actionHandler should be called with perform-node-action
      expect(props.actionHandler).toHaveBeenCalledWith({
        action: "perform-node-action",
        payload: { id: actionId, path },
      });
    });
  });
});

describe("NodeEditor Foxglove settings API", () => {
  it("builds reorder-children actions, with sourcePath only for cross-parent moves", () => {
    const base = { fromKey: "a", toKey: "b", position: "before" as const };
    expect(reorderChildrenAction({ ...base, path: ["p"], sourcePath: ["p"] })).toEqual({
      action: "reorder-children",
      payload: { path: ["p"], ...base },
    });
    expect(reorderChildrenAction({ ...base, path: ["p"], sourcePath: ["q"] })).toEqual({
      action: "reorder-children",
      payload: { path: ["p"], sourcePath: ["q"], ...base },
    });
  });

  function renderReorderableParent(filter?: string) {
    const actionHandler = vi.fn();
    render(
      <NodeEditor
        actionHandler={actionHandler}
        path={["list"]}
        filter={filter}
        settings={{
          label: "List",
          childrenReorderable: true,
          children: {
            a: { label: "A" },
            b: { label: "B" },
            pinned: { label: "Pinned", reorderable: false },
          },
        }}
      />,
    );
    return actionHandler;
  }

  it("adds Move up / Move down to reorderable children and dispatches reorder-children", () => {
    const actionHandler = renderReorderableParent();

    // Only "a" and "b" are reorderable, so only they get a menu.
    const menus = screen.getAllByTestId("node-actions-menu-button");
    expect(menus).toHaveLength(2);

    fireEvent.click(menus[1]!);
    fireEvent.click(screen.getByRole("menuitem", { name: /move up/i }));
    expect(actionHandler).toHaveBeenCalledWith({
      action: "reorder-children",
      payload: { path: ["list"], fromKey: "b", toKey: "a", position: "before" },
    });

    actionHandler.mockClear();
    fireEvent.click(menus[1]!);
    fireEvent.click(screen.getByRole("menuitem", { name: /move down/i }));
    expect(actionHandler).not.toHaveBeenCalled(); // "b" is already last
  });

  it("allows dragging children only while no filter hides any of them", () => {
    renderReorderableParent();
    expect(screen.getByText("A").closest('[class*="nodeHeader"]')).toHaveStyle({ cursor: "grab" });
    expect(screen.getByText("Pinned").closest('[class*="nodeHeader"]')).not.toHaveStyle({
      cursor: "grab",
    });
  });

  it("disables child drag while a tree filter is active", () => {
    renderReorderableParent("a");
    expect(screen.getByText("A").closest('[class*="nodeHeader"]')).not.toHaveStyle({
      cursor: "grab",
    });
  });

  it("shows the warning icon only without an error", () => {
    const { rerender, props } = setupFn({ settings: { label: "x", warning: "careful" } });
    expect(screen.getByTestId("node-warning-icon")).toBeInTheDocument();

    rerender(<NodeEditor {...props} settings={{ label: "x", warning: "careful", error: "bad" }} />);
    expect(screen.queryByTestId("node-warning-icon")).not.toBeInTheDocument();
  });

  it("shows a color swatch when color is set without an icon, and help as the label title", () => {
    setupFn({ settings: { label: "Colored", color: "rgb(255, 0, 0)", help: "Some help" } });
    expect(screen.getByTestId("node-color-swatch")).toHaveStyle({
      background: "rgb(255, 0, 0)",
    });
    expect(screen.getByTitle("Some help")).toHaveTextContent("Colored");
  });

  it("makes the label a drag source when drag is set", () => {
    setupFn({ settings: { label: "Dragged", drag: { type: "topic", topicName: "/t" } } });
    expect(screen.getByTestId("settings-node-drag-source")).toHaveTextContent("Dragged");
  });

  it("disables inline actions marked disabled", () => {
    const { props } = setupFn({
      settings: {
        label: "x",
        actions: [
          {
            type: "action",
            id: "go",
            label: "Go",
            display: "inline",
            icon: "Sync",
            disabled: true,
          },
        ],
      },
    });
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.actionHandler).not.toHaveBeenCalled();
  });
});

describe("dropEdgeAt", () => {
  const element = {
    getBoundingClientRect: () => ({ top: 100, height: 20 }),
  } as unknown as Element;

  it.each([
    [100, "before"],
    [109, "before"],
    [110, "after"],
    [119, "after"],
  ])("clientY %d lands %s", (clientY, expected) => {
    expect(dropEdgeAt(element, clientY)).toBe(expected);
  });
});
