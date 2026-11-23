// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { enqueueSnackbar } from "notistack";
import { useCallback } from "react";

import { useMountedState } from "@lichtblick/hooks";
import {
  LayoutData,
  useCurrentLayoutActions,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import useCallbackWithToast from "@lichtblick/suite-base/hooks/useCallbackWithToast";
import { useLayoutNavigation } from "@lichtblick/suite-base/hooks/useLayoutNavigation";
import { Layout } from "@lichtblick/suite-base/services/ILayoutStorage";
import { Namespace } from "@lichtblick/suite-base/types";
import { downloadTextFile } from "@lichtblick/suite-base/util/download";
import {
  decodeLayoutTrust,
  encodeLayoutTrust,
  validateLayoutData,
} from "@lichtblick/suite-base/util/layout";
import { basename, extname } from "@lichtblick/suite-base/util/path";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";
import { toError } from "@lichtblick/suite-base/util/toError";

import { useLayoutManager } from "../context/LayoutManagerContext";

type UseLayoutTransfer = {
  importLayout: () => Promise<void>;
  exportLayout: () => Promise<void>;
  /**
   * Saves and selects a layout; rejects with AbortError if the optional signal is cancelled.
   * `untrusted` also marks linked layouts that contain no user scripts yet. `from` is stored as
   * Layout.from (e.g. to recognize layouts installed from a link).
   */
  parseAndInstallLayout: (
    file: File,
    namespace: Namespace,
    signal?: AbortSignal,
    options?: { untrusted?: boolean; from?: string },
  ) => Promise<Layout | undefined>;
};

/** Shares layout import/export behavior across file and launch entry points. */
export function useLayoutTransfer(): UseLayoutTransfer {
  const isMounted = useMountedState();
  const layoutManager = useLayoutManager();
  const { onSelectLayout } = useLayoutNavigation();
  const { getCurrentLayoutState } = useCurrentLayoutActions();

  const parseAndInstallLayout = useCallback(
    async (
      file: File,
      namespace: Namespace = "local",
      signal?: AbortSignal,
      options?: { untrusted?: boolean; from?: string },
    ) => {
      const layoutName = basename(file.name, extname(file.name));
      const content = await file.text();

      if (!isMounted()) {
        return;
      }
      signal?.throwIfAborted();

      let parsedState: unknown;
      try {
        parsedState = JSON.parse(content);
      } catch (err: unknown) {
        enqueueSnackbar(`${file.name} is not a valid layout: ${toError(err).message}`, {
          variant: "error",
        });
        return;
      }

      if (typeof parsedState !== "object" || !parsedState) {
        enqueueSnackbar(`${file.name} is not a valid layout`, { variant: "error" });
        return;
      }

      let parsedLayout: LayoutData;
      try {
        parsedLayout = validateLayoutData(parsedState);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        enqueueSnackbar(`${file.name} is not a valid layout: ${errorMessage}`, {
          variant: "error",
        });
        return;
      }

      const { data, untrusted } = decodeLayoutTrust(parsedLayout);
      const newLayout = await layoutManager.saveNewLayout({
        name: layoutName,
        data,
        permission: namespace === "org" ? "ORG_WRITE" : "CREATOR_WRITE",
        from: options?.from,
        untrusted:
          options?.untrusted === true ||
          untrusted === true ||
          Object.keys(data.userNodes ?? {}).length > 0,
      });

      signal?.throwIfAborted();
      void onSelectLayout(newLayout);

      return newLayout;
    },
    [isMounted, layoutManager, onSelectLayout],
  );

  const importLayout = useCallbackWithToast(async () => {
    const fileHandles = await showOpenFilePicker({
      multiple: true,
      excludeAcceptAllOption: false,
      types: [
        {
          description: "JSON Files",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });

    if (fileHandles.length === 0) {
      return;
    }

    await Promise.all(
      fileHandles.map(async (fileHandle) => {
        const file = await fileHandle.getFile();
        return await parseAndInstallLayout(file);
      }),
    );
  }, [parseAndInstallLayout]);

  const exportLayout = useCallbackWithToast(async () => {
    const selectedLayout = getCurrentLayoutState().selectedLayout;
    if (!selectedLayout?.data) {
      return;
    }

    const layout = await layoutManager.getLayout(selectedLayout.id);
    const name = selectedLayout.name?.trim() ?? "";
    const layoutName = name.length > 0 ? name : "lichtblick-layout";
    const content =
      JSON.stringify(encodeLayoutTrust(selectedLayout.data, layout ?? {}), undefined, 2) ?? "";
    downloadTextFile(content, `${layoutName}.json`);
  }, [getCurrentLayoutState, layoutManager]);

  return { importLayout, exportLayout, parseAndInstallLayout };
}
