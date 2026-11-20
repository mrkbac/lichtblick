// SPDX-License-Identifier: MPL-2.0

import { Button, LinearProgress, TextField } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Catalog from "@lichtblick/suite-base/components/Catalog/Catalog";
import { useCatalogUrl } from "@lichtblick/suite-base/components/Catalog/useCatalogUrl";
import Stack from "@lichtblick/suite-base/components/Stack";

import { useStyles } from "./index.style";

const NO_LAST_OPENED: ReadonlyMap<string, number> = new Map();

/** The recordings of a catalog URL, e.g. the sample data; opening one leaves the dialog. */
export function CatalogUrlView({
  url,
  onBack,
  onOpened,
}: {
  url: string;
  onBack: () => void;
  onOpened: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("openDialog");
  const catalog = useCatalogUrl(url);
  const [query, setQuery] = useState("");
  const folder = useMemo(
    () => ({
      ...catalog,
      open: async (...args: Parameters<typeof catalog.open>) => {
        await catalog.open(...args);
        onOpened();
      },
    }),
    [catalog, onOpened],
  );

  return (
    <Stack className={classes.page}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Button onClick={onBack}>{t("backToStart")}</Button>
        <TextField
          size="small"
          type="search"
          fullWidth
          value={query}
          placeholder={t("searchCatalog")}
          aria-label={t("searchCatalog")}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </Stack>
      {/* Until the catalog arrives there is nothing to index or count. */}
      {catalog.progress ? (
        <LinearProgress />
      ) : (
        <Catalog
          folder={folder}
          query={query}
          lastOpenedByName={NO_LAST_OPENED}
          onQueryChange={setQuery}
          initialView="grid"
        />
      )}
    </Stack>
  );
}
