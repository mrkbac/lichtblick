// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
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
import path from "path";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { create } from "zustand";

import Stack from "@lichtblick/suite-base/components/Stack";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { FILE_ACCEPT_TYPE } from "@lichtblick/suite-base/context/Workspace/constants";
import {
  CompareDraft,
  draftFromFiles,
  draftToCompare,
  handlesOf,
  rememberHandle,
} from "@lichtblick/suite-base/util/compareSides";
import showOpenFilePicker from "@lichtblick/suite-base/util/showOpenFilePicker";

import { SIDE_COLORS, sideLabel } from "./CompareContext";

/** The open compare dialog's starting draft, so menus anywhere can open it */
export const useCompareDialog = create<{
  draft: CompareDraft | undefined;
  show: (draft: CompareDraft) => void;
  hide: () => void;
}>()((set) => ({
  draft: undefined,
  show: (draft) => {
    set({ draft });
  },
  hide: () => {
    set({ draft: undefined });
  },
}));

/** Opens the compare dialog with the files open now, so adding recordings starts from them */
export function useShowCompareDialog(): () => void {
  const { selectedFiles, selectedCompare } = usePlayerSelection();
  const show = useCompareDialog((state) => state.show);
  return useCallback(() => {
    show(draftFromFiles(selectedFiles ?? [], selectedCompare));
  }, [selectedFiles, selectedCompare, show]);
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
  files: readonly File[];
  accepts: (file: File) => boolean;
  onFiles: (files: File[]) => void;
  onPick: () => void;
  onRemoveRow?: () => void;
  emptyHint: string;
};

/** One row of files: drop files on it, add more with the picker, remove each with its chip */
function FileRow(props: FileRowProps): React.JSX.Element {
  const { swatch, header, files, accepts, onFiles, onPick, onRemoveRow, emptyHint } = props;
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
            key={`${file.name}-${index}`}
            size="small"
            label={file.name}
            title={file.name}
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
      </div>
    </div>
  );
}

// Rows keep their id while rows around them are added or removed, so a file picker that finishes
// late still fills the row it was opened from
type DialogSide = CompareDraft["sides"][number] & { id: number };
type DialogDraft = { shared: File[]; sides: DialogSide[] };

let nextSideId = 0;
function newSide(files: File[] = [], name = ""): DialogSide {
  return { id: nextSideId++, name, files };
}

/** The draft with row ids and at least two sides, so there is something to compare against */
function toDialogDraft(draft: CompareDraft): DialogDraft {
  const sides = draft.sides.map((side) => newSide(side.files, side.name));
  while (sides.length < 2) {
    sides.push(newSide());
  }
  return { shared: draft.shared, sides };
}

function CompareDialogContent({ initial }: { initial: CompareDraft }): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("compare");
  const hide = useCompareDialog((state) => state.hide);
  const { availableSources, selectSource } = usePlayerSelection();
  const [draft, setDraft] = useState(() => toDialogDraft(initial));
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
  const accepts = (file: File) => extensions.includes(path.extname(file.name));

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
  const updateSide = (id: number, update: (side: DialogSide) => Partial<DialogSide>) => {
    setDraft((old) => ({
      ...old,
      sides: old.sides.map((s) => (s.id === id ? { ...s, ...update(s) } : s)),
    }));
  };

  const { files, compare } = draftToCompare(draft);
  const sideCount = new Set(compare).size;
  const source = sources.find((s) =>
    files.every((file) => s.supportedFileTypes?.includes(path.extname(file.name)) === true),
  );
  const mixed = files.length > 0 && source == undefined;

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
              setDraft((old) => ({ ...old, shared }));
            }}
            onPick={() => {
              pickInto((picked) => {
                setDraft((old) => ({ ...old, shared: [...old.shared, ...picked] }));
              });
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
                  placeholder={side.files[0]?.name ?? t("sideName", { label: sideLabel(index) })}
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
              onRemoveRow={
                draft.sides.length > 2
                  ? () => {
                      setDraft((old) => ({
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
                setDraft((old) => ({ ...old, sides: [...old.sides, newSide()] }));
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
                    setDraft((old) => {
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
          {(error != undefined || mixed) && (
            <Typography variant="body2" color="error">
              {error ?? t("mixedTypes")}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={hide}>{t("cancel")}</Button>
        <Button
          variant="contained"
          disabled={sideCount < 2 || source == undefined}
          onClick={() => {
            // With a handle for every file the comparison is kept in recents; dropped files have none
            const handles = handlesOf(files);
            selectSource(
              source!.id,
              handles ? { type: "file", handles, compare } : { type: "file", files, compare },
            );
            hide();
          }}
        >
          {sideCount < 2 ? t("compare") : t("compareCount", { count: sideCount })}
        </Button>
      </DialogActions>
    </>
  );
}

/** Pick the recordings to compare: one row per side, each merged from any number of files */
export function CompareDialog(): React.JSX.Element | null {
  const draft = useCompareDialog((state) => state.draft);
  const hide = useCompareDialog((state) => state.hide);
  if (!draft) {
    return null;
  }
  return (
    <Dialog open onClose={hide} fullWidth maxWidth="sm">
      <CompareDialogContent initial={draft} />
    </Dialog>
  );
}
