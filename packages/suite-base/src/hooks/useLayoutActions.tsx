// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Dispatch } from "react";

import {
  LayoutSelectionAction,
  LayoutSelectionState,
} from "@lichtblick/suite-base/components/LayoutBrowser/types";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import useCallbackWithToast from "@lichtblick/suite-base/hooks/useCallbackWithToast";
import { useConfirm } from "@lichtblick/suite-base/hooks/useConfirm";
import { UseLayoutNavigation } from "@lichtblick/suite-base/hooks/useLayoutNavigation";
import {
  Layout,
  layoutIsShared,
  personalLayoutCopy,
} from "@lichtblick/suite-base/services/ILayoutStorage";

export type LayoutSetupOptions = {
  state: LayoutSelectionState;
  dispatch: Dispatch<LayoutSelectionAction>;
};

type UseLayoutActions = {
  onRenameLayout: (item: Layout, newName: string) => Promise<void>;
  onDuplicateLayout: (item: Layout) => Promise<void>;
  onDeleteLayout: (item: Layout) => Promise<void>;
  onRevertLayout: (item: Layout) => Promise<void>;
  onOverwriteLayout: (item: Layout) => Promise<void>;
  confirmModal: React.JSX.Element | undefined;
};

const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

/** `state`, `dispatch` and `onSelectLayout` come from the caller's one useLayoutNavigation. */
export function useLayoutActions({
  state,
  dispatch,
  onSelectLayout,
}: LayoutSetupOptions & Pick<UseLayoutNavigation, "onSelectLayout">): UseLayoutActions {
  const layoutManager = useLayoutManager();
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const [confirm, confirmModal] = useConfirm();

  const onRenameLayout = useCallbackWithToast(
    async (item: Layout, newName: string) => {
      await layoutManager.updateLayout({ id: item.id, name: newName });
      if (item.id === currentLayoutId) {
        // Reload so the shown layout picks up its new name.
        setSelectedLayoutId(item.id);
      }
    },
    [currentLayoutId, layoutManager, setSelectedLayoutId],
  );

  const onDuplicateLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "duplicate" });
        return;
      }

      const newLayout = await layoutManager.saveNewLayout(
        personalLayoutCopy(item, `${item.name} copy`),
      );
      await onSelectLayout(newLayout);
    },
    [dispatch, layoutManager, onSelectLayout, state.selectedIds.length],
  );

  const onDeleteLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "delete" });
        return;
      }

      // If the layout was selected, select a different available layout.
      //
      // When a users current layout is deleted, we display a notice. By selecting a new layout
      // before deleting their current layout we avoid the weirdness of displaying a notice that the
      // user just deleted their current layout which is somewhat obvious to the user.
      if (currentLayoutId === item.id) {
        const storedLayouts = await layoutManager.getLayouts();
        const targetLayout = storedLayouts.find((layout) => layout.id !== currentLayoutId);
        setSelectedLayoutId(targetLayout?.id);
        dispatch({ type: "select-id", id: targetLayout?.id });
      }
      await layoutManager.deleteLayout({ id: item.id });
    },
    [currentLayoutId, dispatch, layoutManager, setSelectedLayoutId, state.selectedIds.length],
  );

  const onOverwriteLayout = useCallbackWithToast(
    async (item: Layout) => {
      // We don't need to confirm the multiple selection case because we force users to save
      // or abandon changes before selecting another layout with unsaved changes to the current
      // shared layout.
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "save" });
        return;
      }

      //this condition is related to organization layouts, something LB
      //doesn't have active
      if (layoutIsShared(item)) {
        const response = await confirm({
          title: `Update “${item.name}”?`,
          prompt:
            "Your changes will overwrite this layout for all organization members. This cannot be undone.",
          ok: "Save",
        });
        if (response !== "ok") {
          return;
        }
      }
      await layoutManager.overwriteLayout({ id: item.id });
    },
    [confirm, dispatch, layoutManager, state.selectedIds.length],
  );

  const onRevertLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "revert" });
        return;
      }

      await layoutManager.revertLayout({ id: item.id });
    },
    [dispatch, layoutManager, state.selectedIds.length],
  );

  return {
    onRenameLayout,
    onDuplicateLayout,
    onDeleteLayout,
    onRevertLayout,
    onOverwriteLayout,
    confirmModal,
  };
}
