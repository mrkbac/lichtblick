// SPDX-License-Identifier: MPL-2.0

import { useEffect, useMemo, useState } from "react";

import { useAppLaunch } from "@lichtblick/suite-base/util/appLaunch";
import { toError } from "@lichtblick/suite-base/util/toError";

import { ServedCatalog, parseCatalog } from "./catalogUrl";
import { CatalogRecording } from "./types";
import { CatalogFolder } from "./useCatalogFolder";

/** The recordings a catalog URL lists, opened from their URLs with their layouts. */
export function useCatalogUrl(url: string): CatalogFolder {
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
          throw new Error(`Could not load the catalog (HTTP ${response.status})`);
        }
        setCatalog(parseCatalog(await response.json(), response.url || url));
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(toError(err).message);
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [url]);

  return useMemo(
    (): CatalogFolder => ({
      name: catalog?.name ?? new URL(url, window.location.href).hostname,
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
