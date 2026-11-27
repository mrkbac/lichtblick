// SPDX-License-Identifier: MPL-2.0

import {
  Button,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Popover,
  Select,
  Switch,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Catalog from "@lichtblick/suite-base/components/Catalog/Catalog";
import { forgetCatalogFolder } from "@lichtblick/suite-base/components/Catalog/indexFolder";
import { CatalogBackend } from "@lichtblick/suite-base/components/Catalog/types";
import { useCatalogFolder } from "@lichtblick/suite-base/components/Catalog/useCatalogFolder";
import { useCatalogUrl } from "@lichtblick/suite-base/components/Catalog/useCatalogUrl";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

type SavedCatalog = {
  id: string;
  name?: string;
  hidden?: boolean;
} & ({ kind: "local" } | { kind: "remote"; url: string });

const STORAGE_KEY = "saved-catalogs";
export const DEFAULT_CATALOG = "last";
const DEFAULT_SOURCE: SavedCatalog = { id: DEFAULT_CATALOG, kind: "local" };

export function useSavedCatalogs(): [
  SavedCatalog[],
  React.Dispatch<React.SetStateAction<SavedCatalog[]>>,
] {
  const [sources, setSources] = useState<SavedCatalog[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedCatalog[];
      return [
        saved.find((source) => source.id === DEFAULT_CATALOG) ?? DEFAULT_SOURCE,
        ...saved.filter((source) => source.id !== DEFAULT_CATALOG),
      ];
    } catch {
      return [DEFAULT_SOURCE];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sources) ?? "[]");
    } catch {
      // Catalogs remain available for this session when storage is unavailable.
    }
  }, [sources]);
  return [sources, setSources];
}

type CatalogProps = Omit<React.ComponentProps<typeof Catalog>, "folder">;

function LocalCatalog({
  source,
  onName,
  ...props
}: CatalogProps & {
  source: SavedCatalog;
  onName: (id: string, name: string) => void;
}): React.JSX.Element {
  const folder = useCatalogFolder(source.id);
  const name = folder.name ?? folder.lastFolder?.name;
  useEffect(() => {
    if (name != undefined && name !== source.name) {
      onName(source.id, name);
    }
  }, [name, onName, source.id, source.name]);
  return <Catalog {...props} folder={folder} />;
}

function RemoteCatalog({
  source,
  onName,
  ...props
}: CatalogProps & {
  source: Extract<SavedCatalog, { kind: "remote" }>;
  onName: (id: string, name: string) => void;
}): React.JSX.Element {
  const backend = useCatalogUrl(source.url);
  const { dialogActions } = useWorkspaceActions();
  const name =
    backend.progress == undefined && backend.error == undefined ? backend.name : undefined;
  useEffect(() => {
    if (name != undefined && name !== source.name) {
      onName(source.id, name);
    }
  }, [name, onName, source.id, source.name]);
  return (
    <Catalog
      {...props}
      folder={{
        ...backend,
        open: async (recording) => {
          await backend.open(recording);
          dialogActions.dataSource.close();
        },
      }}
    />
  );
}

export function SavedCatalogs({
  sources,
  selected,
  select,
  setSources,
  visited,
  folder,
  visible,
  ...catalogProps
}: CatalogProps & {
  sources: SavedCatalog[];
  selected: string;
  select: (id: string) => void;
  setSources: React.Dispatch<React.SetStateAction<SavedCatalog[]>>;
  visited: ReadonlySet<string>;
  folder: CatalogBackend;
  visible: boolean;
}): React.JSX.Element {
  const { t } = useTranslation("catalog");
  const [anchor, setAnchor] = useState<HTMLElement>();
  const [filter, setFilter] = useState("");
  const shown = sources.filter((source) => source.hidden !== true);
  const active = shown.find((source) => source.id === selected);
  const activeId = active?.id ?? "";
  const displayName = (source: SavedCatalog) =>
    source.id === DEFAULT_CATALOG
      ? (folder.name ?? folder.lastFolder?.name ?? t("localFolder"))
      : (source.name ??
        (source.kind === "remote" ? new URL(source.url).host : t("newLocalFolder")));
  const rememberName = (id: string, name: string) => {
    setSources((previous) =>
      previous.map((source) => (source.id === id ? { ...source, name } : source)),
    );
  };

  return (
    <>
      <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
        <Select
          size="small"
          value={activeId}
          displayEmpty
          inputProps={{ "aria-label": t("catalogSource") }}
          onChange={(event) => {
            select(event.target.value);
          }}
        >
          <MenuItem value="" disabled>
            {t("selectCatalog")}
          </MenuItem>
          {shown.map((source) => (
            <MenuItem key={source.id} value={source.id}>
              {displayName(source)}
            </MenuItem>
          ))}
        </Select>
        <Button
          size="small"
          onClick={() => {
            const id = randomUUID();
            setSources((previous) => [...previous, { id, kind: "local" }]);
            select(id);
          }}
        >
          {t("addLocalCatalog")}
        </Button>
        <Button
          size="small"
          onClick={(event) => {
            setAnchor(event.currentTarget);
          }}
        >
          {t("manageCatalogs")}
        </Button>
      </Stack>
      <Popover
        open={anchor != undefined}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(undefined);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Stack gap={1} padding={1.5} style={{ width: 440, maxWidth: "90vw" }}>
          <TextField
            autoFocus
            size="small"
            label={t("filterCatalogs")}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />
          <List dense disablePadding style={{ maxHeight: 360, overflow: "auto" }}>
            {sources
              .filter((source) =>
                displayName(source).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
              )
              .map((source) => (
                <ListItem key={source.id} disableGutters>
                  <ListItemText
                    primary={displayName(source)}
                    secondary={t(source.kind === "local" ? "localFolder" : "remoteCatalog")}
                    slotProps={{ primary: { noWrap: true } }}
                  />
                  <FormControlLabel
                    label={t("showCatalog")}
                    control={
                      <Switch
                        size="small"
                        checked={source.hidden !== true}
                        slotProps={{
                          input: {
                            "aria-label": t("showCatalogNamed", { name: displayName(source) }),
                          },
                        }}
                        onChange={(_event, checked) => {
                          setSources((previous) =>
                            previous.map((item) =>
                              item.id === source.id ? { ...item, hidden: !checked } : item,
                            ),
                          );
                          if (!checked && activeId === source.id) {
                            select(shown.find((item) => item.id !== source.id)?.id ?? "");
                          }
                        }}
                      />
                    }
                  />
                  {source.id !== DEFAULT_CATALOG && (
                    <Button
                      size="small"
                      aria-label={t("removeCatalogNamed", { name: displayName(source) })}
                      onClick={() => {
                        setSources((previous) => previous.filter((item) => item.id !== source.id));
                        if (source.kind === "local") {
                          void forgetCatalogFolder(source.id).catch((err: unknown) => {
                            console.warn("Failed to forget catalog folder", err);
                          });
                        }
                        if (activeId === source.id) {
                          select(shown.find((item) => item.id !== source.id)?.id ?? "");
                        }
                      }}
                    >
                      {t("removeCatalog")}
                    </Button>
                  )}
                </ListItem>
              ))}
          </List>
        </Stack>
      </Popover>
      {visible && activeId === DEFAULT_CATALOG && <Catalog {...catalogProps} folder={folder} />}
      {sources
        .filter(
          (source) =>
            source.kind === "local" && source.id !== DEFAULT_CATALOG && visited.has(source.id),
        )
        .map((source) => (
          <Stack
            key={source.id}
            flex="1"
            style={{ minHeight: 0, display: activeId === source.id ? "flex" : "none" }}
          >
            <LocalCatalog {...catalogProps} source={source} onName={rememberName} />
          </Stack>
        ))}
      {visible && active?.kind === "remote" && (
        <RemoteCatalog key={active.id} {...catalogProps} source={active} onName={rememberName} />
      )}
    </>
  );
}
