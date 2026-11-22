// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import LayersIcon from "@mui/icons-material/Layers";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Stack from "@lichtblick/suite-base/components/Stack";
import {
  DataSourceArgs,
  IDataSourceFactory,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { FILE_ACCEPT_TYPE } from "@lichtblick/suite-base/context/Workspace/constants";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import {
  CompareDraft,
  Recording,
  draftToCompare,
  encodeCompareNames,
  handlesOf,
  recordingExtension,
  recordingName,
  rememberHandle,
} from "@lichtblick/suite-base/util/compareSides";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";
import { useSourcePick } from "@lichtblick/suite-base/util/sourcePick";

import { SIDE_COLORS, sideLabel } from "./CompareContext";
import { compareSourceFor, useCompareDialog } from "./compareDialogStore";

/**
 * The recordings `source` opened with `args` reads, and whether its URLs are fetched with cookies.
 * A live connection or a sample has none.
 */
async function recordingsOf(
  source: IDataSourceFactory | undefined,
  args: DataSourceArgs | undefined,
): Promise<{ recordings: Recording[]; withCookies: boolean }> {
  if (args?.type === "connection") {
    // Only sources that read recording files (not live connections, whatever their URL ends with)
    const urls = source?.supportedFileTypes != undefined ? args.params?.url?.split(",") : undefined;
    const isHttp = (url: string) => /^https?:\/\//i.test(url);
    return {
      recordings: urls?.every(isHttp) === true ? urls : [],
      withCookies: args.params?.includeCredentials === "true",
    };
  }
  return { recordings: await filesOf(args), withCookies: false };
}

async function filesOf(args: DataSourceArgs | undefined): Promise<Recording[]> {
  if (args?.type !== "file") {
    return [];
  }
  if (args.handles) {
    return await Promise.all(
      args.handles.map(async (handle) => {
        if (typeof handle === "string") {
          return handle;
        }
        if ((await handle.queryPermission({ mode: "read" })) !== "granted") {
          if ((await handle.requestPermission({ mode: "read" })) !== "granted") {
            throw new Error(`Permission denied: ${handle.name}`);
          }
        }
        const file = await handle.getFile();
        rememberHandle(file, handle);
        return file;
      }),
    );
  }
  return args.files ?? [];
}

const useStyles = makeStyles()((theme) => ({
  row: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "start",
    columnGap: theme.spacing(1.5),
    rowGap: theme.spacing(1),
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.borderRadius,
    border: `1px dashed ${theme.palette.divider}`,
  },
  dragOver: {
    borderColor: theme.palette.primary.main,
    backgroundColor: theme.palette.action.hover,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    color: "#000",
    fontWeight: 700,
    lineHeight: "28px",
    textAlign: "center",
  },
  sharedSwatch: {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.palette.text.secondary,
  },
  files: {
    gridColumn: 2,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing(0.5),
  },
}));

type FileRowProps = {
  swatch: React.ReactNode;
  header: React.ReactNode;
  files: readonly Recording[];
  accepts: (file: File) => boolean;
  onFiles: (files: Recording[]) => void;
  onPick: () => void;
  onPickElsewhere: () => void;
  onRemoveRow?: () => void;
  emptyHint: string;
};

/** One row of files: drop files on it, add more with the picker, remove each with its chip */
function FileRow(props: FileRowProps): React.JSX.Element {
  const {
    swatch,
    header,
    files,
    accepts,
    onFiles,
    onPick,
    onPickElsewhere,
    onRemoveRow,
    emptyHint,
  } = props;
  const { classes, cx } = useStyles();
  const { t } = useTranslation("compare");
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={cx(classes.row, { [classes.dragOver]: dragOver })}
      // Handled here so the window-wide drop listener doesn't open the files instead
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={() => {
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        onFiles([...files, ...Array.from(event.dataTransfer.files).filter(accepts)]);
      }}
    >
      {swatch}
      {header}
      {onRemoveRow ? (
        <Tooltip title={t("removeRecording")}>
          <IconButton size="small" aria-label={t("removeRecording")} onClick={onRemoveRow}>
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <span />
      )}
      <div className={classes.files}>
        {files.map((file, index) => (
          <Chip
            key={`${recordingName(file)}-${index}`}
            size="small"
            icon={typeof file === "string" ? <CloudOutlinedIcon /> : undefined}
            label={recordingName(file)}
            title={typeof file === "string" ? file : file.name}
            onDelete={() => {
              onFiles(files.filter((_, i) => i !== index));
            }}
          />
        ))}
        {files.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            {emptyHint}
          </Typography>
        )}
        <Button size="small" startIcon={<AddIcon />} onClick={onPick}>
          {t("addFiles")}
        </Button>
        <Tooltip title={t("addFromHint")}>
          <Button size="small" startIcon={<AddIcon />} onClick={onPickElsewhere}>
            {t("addFrom")}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

// Rows keep their id while rows around them are added or removed, so a file picker that finishes
// late still fills the row it was opened from
type DialogSide = CompareDraft["sides"][number] & { id: number };
type DialogDraft = { shared: Recording[]; sides: DialogSide[]; withCookies: readonly string[] };

let nextSideId = 0;
function newSide(files: Recording[] = [], name = ""): DialogSide {
  return { id: nextSideId++, name, files };
}

/** The draft with row ids and at least two sides, so there is something to compare against */
function toDialogDraft(draft: CompareDraft): DialogDraft {
  const sides = draft.sides.map((side) => newSide(side.files, side.name));
  while (sides.length < 2) {
    sides.push(newSide());
  }
  return { shared: draft.shared, sides, withCookies: draft.withCookies ?? [] };
}

function CompareDialogContent({ initial }: { initial: CompareDraft }): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("compare");
  const hide = useCompareDialog((state) => state.hide);
  const { availableSources, selectSource } = usePlayerSelection();
  const [draft, setDraft] = useState(() => toDialogDraft(initial));
  // The latest draft, ahead of renders: picks finishing close together each check and change the
  // draft the one before left, not the one their render saw
  const draftRef = useRef(draft);
  const updateDraft = (update: (old: DialogDraft) => DialogDraft) => {
    draftRef.current = update(draftRef.current);
    setDraft(draftRef.current);
  };
  const [error, setError] = useState<string | undefined>();

  const sources = useMemo(
    () =>
      availableSources.filter(
        (source) => source.type === "file" && source.supportsCompare === true,
      ),
    [availableSources],
  );
  const extensions = useMemo(
    () => [...new Set(sources.flatMap((source) => source.supportedFileTypes ?? []))],
    [sources],
  );
  const accepts = (file: Recording) => extensions.includes(recordingExtension(file));
  const { dialogActions } = useWorkspaceActions();
  const pickOpen = useWorkspaceStore((store) => store.dialogs.dataSource.open);

  // A pick ends with the open dialog: closing it without opening anything cancels the pick
  useEffect(() => {
    if (!pickOpen) {
      useSourcePick.setState({ pick: undefined });
    }
  }, [pickOpen]);
  useEffect(
    () => () => {
      useSourcePick.setState({ pick: undefined });
    },
    [],
  );

  const pick = async (): Promise<File[]> => {
    const handles = await showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: extensions.join(", "),
          accept: { [FILE_ACCEPT_TYPE]: extensions as `.${string}`[] },
        },
      ],
    });
    return await Promise.all(
      handles.map(async (handle) => {
        const file = await handle.getFile();
        rememberHandle(file, handle);
        return file;
      }),
    );
  };
  const pickInto = (apply: (picked: File[]) => void) => {
    pick()
      .then((picked) => {
        if (picked.length > 0) {
          apply(picked);
        }
      })
      .catch((err: unknown) => {
        setError(String(err));
      });
  };
  /**
   * Pick recordings for a row in the app's open dialog: whatever the user opens there (a recent, a
   * URL, a catalog entry, a sample, a local file) is added to the row instead of being opened
   */
  const pickElsewhere = (
    label: string,
    add: (old: DialogDraft, picked: Recording[]) => DialogDraft,
  ) => {
    setError(undefined);
    useSourcePick.setState({
      pick: {
        label,
        deliver: (sourceId, args) => {
          dialogActions.dataSource.close();
          const source = availableSources.find(
            (s) => s.id === sourceId || s.legacyIds?.includes(sourceId) === true,
          );
          recordingsOf(source, args)
            .then(({ recordings: picked, withCookies }) => {
              const unsupported = picked.find((r) => !accepts(r));
              // One URL, one cookie policy: the same recording can't be fetched both ways. Checked
              // and committed against the latest draft in one step.
              const current = draftRef.current;
              const inDraft = new Set([
                ...current.shared,
                ...current.sides.flatMap((s) => s.files),
              ]);
              const conflict = picked.find(
                (r) =>
                  typeof r === "string" &&
                  inDraft.has(r) &&
                  current.withCookies.includes(r) !== withCookies,
              );
              if (conflict != undefined) {
                setError(t("cookiesConflict", { name: recordingName(conflict) }));
                return;
              }
              if (picked.length === 0 || unsupported != undefined) {
                setError(
                  t("notComparable", {
                    name: unsupported != undefined ? recordingName(unsupported) : t("thisSource"),
                    types: extensions.join(", "),
                  }),
                );
                return;
              }
              // The draft's cookie setting for each picked URL follows this pick
              const urls = picked.filter((r) => typeof r === "string");
              updateDraft((old) =>
                add(
                  {
                    ...old,
                    withCookies: [
                      ...old.withCookies.filter((url) => !urls.includes(url)),
                      ...(withCookies ? urls : []),
                    ],
                  },
                  picked,
                ),
              );
            })
            .catch((err: unknown) => {
              setError(String(err));
            });
        },
      },
    });
    dialogActions.dataSource.open("start");
  };
  const updateSide = (id: number, update: (side: DialogSide) => Partial<DialogSide>) => {
    updateDraft((old) => ({
      ...old,
      sides: old.sides.map((s) => (s.id === id ? { ...s, ...update(s) } : s)),
    }));
  };

  const { files, compare } = draftToCompare(draft);
  const sideCount = new Set(compare).size;
  const source = compareSourceFor(files, sources);
  const mixed = files.length > 0 && source == undefined;
  const urls = files.filter((file): file is string => typeof file === "string");
  // Only remote recordings: opened as one remote source, so the comparison can be shared as a link
  const remoteSource =
    urls.length === files.length
      ? availableSources.find(
          (s) =>
            s.type === "connection" &&
            urls.every((url) => s.supportedFileTypes?.includes(recordingExtension(url)) === true),
        )
      : undefined;
  // Cookies (`ds.includeCredentials`) are one setting for a whole remote comparison, and files
  // mixed with URLs are opened without them
  const withCookies = urls.filter((url) => draft.withCookies.includes(url));
  const cookiesMixed =
    withCookies.length > 0 && (withCookies.length !== urls.length || remoteSource == undefined);

  return (
    <>
      <DialogTitle>{t("dialogTitle")}</DialogTitle>
      <DialogContent>
        <Stack gap={1.5}>
          <Typography variant="body2" color="text.secondary">
            {t("dialogHint")}
          </Typography>
          <FileRow
            swatch={
              <span className={classes.sharedSwatch}>
                <LayersIcon />
              </span>
            }
            header={
              <Stack>
                <Typography variant="subtitle2">{t("shared")}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("sharedHint")}
                </Typography>
              </Stack>
            }
            files={draft.shared}
            accepts={accepts}
            emptyHint={t("sharedEmpty")}
            onFiles={(shared) => {
              updateDraft((old) => ({ ...old, shared }));
            }}
            onPick={() => {
              pickInto((picked) => {
                updateDraft((old) => ({ ...old, shared: [...old.shared, ...picked] }));
              });
            }}
            onPickElsewhere={() => {
              pickElsewhere(t("sharedPick"), (old, picked) => ({
                ...old,
                shared: [...old.shared, ...picked],
              }));
            }}
          />
          {draft.sides.map((side, index) => (
            <FileRow
              key={side.id}
              swatch={
                <span
                  className={classes.swatch}
                  style={{ backgroundColor: SIDE_COLORS[index % SIDE_COLORS.length] }}
                >
                  {sideLabel(index)}
                </span>
              }
              header={
                <TextField
                  size="small"
                  variant="standard"
                  value={side.name}
                  placeholder={
                    side.files[0] != undefined
                      ? recordingName(side.files[0])
                      : t("sideName", { label: sideLabel(index) })
                  }
                  slotProps={{ htmlInput: { "aria-label": t("sideNameLabel") } }}
                  onChange={(event) => {
                    const name = event.target.value;
                    updateSide(side.id, () => ({ name }));
                  }}
                />
              }
              files={side.files}
              accepts={accepts}
              emptyHint={t("sideEmpty")}
              onFiles={(sideFiles) => {
                updateSide(side.id, () => ({ files: sideFiles }));
              }}
              onPick={() => {
                pickInto((picked) => {
                  updateSide(side.id, (s) => ({ files: [...s.files, ...picked] }));
                });
              }}
              onPickElsewhere={() => {
                pickElsewhere(t("sideName", { label: sideLabel(index) }), (old, picked) => ({
                  ...old,
                  sides: old.sides.map((s) =>
                    s.id === side.id ? { ...s, files: [...s.files, ...picked] } : s,
                  ),
                }));
              }}
              onRemoveRow={
                draft.sides.length > 2
                  ? () => {
                      updateDraft((old) => ({
                        ...old,
                        sides: old.sides.filter((s) => s.id !== side.id),
                      }));
                    }
                  : undefined
              }
            />
          ))}
          <Stack direction="row" gap={1}>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => {
                updateDraft((old) => ({ ...old, sides: [...old.sides, newSide()] }));
              }}
            >
              {t("addRecording")}
            </Button>
            <Tooltip title={t("addRecordingsHint")}>
              <Button
                size="small"
                onClick={() => {
                  // Each picked file becomes a recording of its own, filling empty rows first
                  pickInto((picked) => {
                    updateDraft((old) => {
                      const sides = [...old.sides];
                      for (const file of picked) {
                        const empty = sides.findIndex((s) => s.files.length === 0);
                        if (empty === -1) {
                          sides.push(newSide([file]));
                        } else {
                          sides[empty] = { ...sides[empty]!, files: [file] };
                        }
                      }
                      return { ...old, sides };
                    });
                  });
                }}
              >
                {t("addRecordings")}
              </Button>
            </Tooltip>
          </Stack>
          {(error != undefined || mixed || cookiesMixed) && (
            <Typography variant="body2" color="error">
              {error ??
                (mixed ? t("mixedTypes", { types: extensions.join(", ") }) : t("cookiesMixed"))}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={hide}>{t("cancel")}</Button>
        <Button
          variant="contained"
          disabled={sideCount < 2 || source == undefined || cookiesMixed}
          onClick={() => {
            if (remoteSource) {
              selectSource(remoteSource.id, {
                type: "connection",
                params: {
                  url: urls.join(","),
                  compareNames: encodeCompareNames(compare),
                  ...(withCookies.length > 0 && { includeCredentials: "true" }),
                },
              });
            } else {
              // With a handle for every file the comparison is kept in recents; dropped files have
              // none
              const handles = handlesOf(files);
              selectSource(
                source!.id,
                handles ? { type: "file", handles, compare } : { type: "file", files, compare },
              );
            }
            hide();
          }}
        >
          {sideCount < 2 ? t("compare") : t("compareCount", { count: sideCount })}
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * Pick the recordings to compare: one row per side, each merged from any number of files. Loaded
 * only once a comparison is being edited (see compareDialogStore).
 */
export function CompareDialog(): React.JSX.Element | null {
  const draft = useCompareDialog((state) => state.draft);
  const hide = useCompareDialog((state) => state.hide);
  // Out of the way (but kept, with its rows) while a recording is picked in the open dialog
  const picking = useSourcePick((state) => state.pick != undefined);
  if (!draft) {
    return null;
  }
  return (
    <Dialog open={!picking} keepMounted onClose={hide} fullWidth maxWidth="sm">
      <CompareDialogContent initial={draft} />
    </Dialog>
  );
}
