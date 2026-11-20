// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppLaunch } from "@lichtblick/suite-base/util/appLaunch";
import { toError } from "@lichtblick/suite-base/util/toError";

import { CatalogError, ServedCatalog, parseCatalog } from "./catalogUrl";
import { CatalogRecording } from "./types";
import { CatalogFolder } from "./useCatalogFolder";

/** A name for the catalog until it loads; a URL that doesn't parse fails in the fetch instead. */
function hostOf(url: string): string {
  try {
    return new URL(url, window.location.href).hostname;
  } catch {
    return url;
  }
}

/** The recordings a catalog URL lists, opened from their URLs with their layouts. */
export function useCatalogUrl(url: string): CatalogFolder {
  const { t } = useTranslation("catalog");
  const [catalog, setCatalog] = useState<ServedCatalog>();
  const [error, setError] = useState<string>();
  const launch = useAppLaunch((state) => state.launch);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(undefined);
    setError(undefined);
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          setError(t("catalogHttpError", { status: response.status }));
          return;
        }
        setCatalog(parseCatalog(await response.json(), response.url || url));
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        // Schema errors have their own messages; anything else (network, JSON) is passed on.
        setError(
          err instanceof CatalogError
            ? t(err.key, err.params)
            : t("catalogLoadError", { reason: toError(err).message }),
        );
      }
    })();
    return () => {
      controller.abort();
    };
  }, [url, t]);

  return useMemo(
    (): CatalogFolder => ({
      name: catalog?.name ?? hostOf(url),
      recordings: catalog?.recordings ?? [],
      progress: catalog == undefined && error == undefined ? { done: 0, total: 1 } : undefined,
      error,
      open: async ({ source, layoutUrl }: CatalogRecording) => {
        if (source.type !== "local-file") {
          launch({ ds: source.type, dsParams: { url: source.url }, layoutUrl });
        }
      },
      loadPreview: async () => {
        throw new Error("Catalog URL recordings have no preview clips");
      },
      reopenLastFolder: async () => {},
      dropFolder: () => false,
      accessDenied: false,
      pickerClosed: false,
      pickFolderWithInput: () => {},
    }),
    [catalog, error, url, launch],
  );
}
