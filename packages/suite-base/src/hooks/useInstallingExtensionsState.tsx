// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SnackbarKey, useSnackbar } from "notistack";
import { useCallback, useEffect, useRef } from "react";

import {
  ExtensionData,
  useExtensionCatalog,
  UseInstallingExtensionsState,
  UseInstallingExtensionsStateProps,
} from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

import {
  IDLE_INSTALLING_PROGRESS,
  useInstallingExtensionsStore,
} from "./useInstallingExtensionsStore";

const plural = (count: number) => (count > 1 ? "s" : "");

export function useInstallingExtensionsState({
  isPlaying,
  playerEvents: { play },
}: UseInstallingExtensionsStateProps): UseInstallingExtensionsState {
  const installExtensions = useExtensionCatalog((state) => state.installExtensions);
  const setInstallingProgress = useInstallingExtensionsStore(
    (state) => state.setInstallingProgress,
  );
  const progress = useInstallingExtensionsStore((state) => state.installingProgress);

  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const progressSnackbarKeyRef = useRef<SnackbarKey>(`installing-extensions-${randomUUID()}`);
  const progressSnackbarKey = progressSnackbarKeyRef.current;

  useEffect(() => {
    const { installed, total } = progress;
    if (total === 0 || installed === total) {
      closeSnackbar(progressSnackbarKey);
      return;
    }

    enqueueSnackbar(`Installing ${total} extensions...`, {
      key: progressSnackbarKey,
      variant: "info",
      persist: true,
      preventDuplicate: true,
    });
  }, [progress, enqueueSnackbar, closeSnackbar, progressSnackbarKey]);

  const installFoxeExtensions = useCallback(
    async (extensionsData: ExtensionData[]) => {
      const total = extensionsData.length;
      setInstallingProgress({ installed: 0, total, inProgress: true });

      const isPlayingInitialState = isPlaying;

      try {
        let installed = 0;
        let failed = 0;
        let warned = 0;
        // Extensions whose browser cache (IndexedDB) loader failed
        let cacheFailures = 0;

        // One at a time, so the progress snackbar advances per extension
        for (const extension of extensionsData) {
          for (const { success, error, loaderResults } of await installExtensions("local", [
            extension,
          ])) {
            if (success) {
              installed++;
              if (error != undefined && loaderResults) {
                warned++;
              }
            } else {
              failed++;
            }
            if (loaderResults?.some((r) => r.loaderType === "browser" && !r.success) === true) {
              cacheFailures++;
            }
          }
          setInstallingProgress({ installed, total, inProgress: true });
        }

        if (failed === 0 && warned === 0) {
          enqueueSnackbar(`Successfully installed all ${total} extensions.`, {
            variant: "success",
            preventDuplicate: true,
          });
        } else if (installed > 0) {
          const message =
            failed > 0
              ? `Installed ${installed} of ${total} extensions successfully.`
              : `Successfully installed all ${total} extensions with some warnings.`;
          enqueueSnackbar(message, { variant: "warning", preventDuplicate: true });

          const issueMessages: string[] = [];
          if (cacheFailures > 0) {
            issueMessages.push(
              `${cacheFailures} extension${plural(cacheFailures)} not saved to local cache`,
            );
          }
          if (failed > 0) {
            issueMessages.push(`${failed} extension${plural(failed)} failed completely`);
          }
          if (issueMessages.length > 0) {
            enqueueSnackbar(`Issues: ${issueMessages.join(", ")}.`, {
              variant: failed > 0 ? "error" : "warning",
              preventDuplicate: true,
              persist: true,
            });
          }
        } else {
          enqueueSnackbar(`Failed to install all ${total} extensions.`, {
            variant: "error",
            preventDuplicate: true,
          });
          if (cacheFailures > 0) {
            enqueueSnackbar(`Details: ${cacheFailures} could not be saved to cache.`, {
              variant: "error",
              preventDuplicate: true,
              persist: true,
            });
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        enqueueSnackbar(`An error occurred during extension installation: ${errorMessage}`, {
          variant: "error",
        });
      } finally {
        if (isPlayingInitialState) {
          play?.();
        }
        setInstallingProgress(IDLE_INSTALLING_PROGRESS);
      }
    },
    [setInstallingProgress, isPlaying, enqueueSnackbar, installExtensions, play],
  );

  return { installFoxeExtensions };
}
