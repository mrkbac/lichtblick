// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapIndexedReader, McapTypes } from "@mcap/core";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import { ExportCompression, exportMcap, loadDecompressHandlers } from "@lichtblick/mcap-support";
import { toNanoSec } from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { BlobReadable } from "@lichtblick/suite-base/players/IterablePlayer/Mcap/BlobReadable";

import { useStyles } from "./ExportRecordingDialog.style";
import {
  TopicEdit,
  createChunkWorkerPool,
  exportFileName,
  findDuplicateOutputTopics,
  getTopicRows,
  openExportOutput,
  toExportTopics,
} from "./exportRecording";
import { useTrimStore } from "./trimStore";

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;

const NS_PER_SEC = 1e9;

function parseEveryNth(text: string): number {
  const n = Math.floor(Number(text));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function toSecondsText(ns: bigint): string {
  return (Number(ns) / NS_PER_SEC).toFixed(3);
}

type Props = {
  file: File;
  onClose: () => void;
};

export function ExportRecordingDialog({ file, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation("exportRecording");

  const readable = useMemo(() => new BlobReadable(file), [file]);
  const opened = useAsync(async () => {
    return await McapIndexedReader.Initialize({
      readable,
      decompressHandlers: await loadDecompressHandlers(),
    });
  }, [readable]);
  const reader = opened.value;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {t("title")}
        <Typography variant="body2" color="text.secondary" noWrap>
          {file.name}
        </Typography>
      </DialogTitle>
      {opened.loading && (
        <DialogContent>
          <Typography>{t("opening")}</Typography>
          <LinearProgress />
        </DialogContent>
      )}
      {opened.error && (
        <DialogContent>
          <Alert severity="error">{opened.error.message}</Alert>
        </DialogContent>
      )}
      {reader && <ExportForm file={file} reader={reader} readable={readable} onClose={onClose} />}
      {!reader && (
        <DialogActions>
          <Button onClick={onClose}>{t("close")}</Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

function ExportForm({
  file,
  reader,
  readable,
  onClose,
}: Props & { reader: McapIndexedReader; readable: McapTypes.IReadable }): React.JSX.Element {
  const { t } = useTranslation("exportRecording");
  const { classes } = useStyles();
  const currentTime = useMessagePipeline(selectCurrentTime);

  const recordingStart = reader.statistics?.messageStartTime ?? 0n;
  const recordingEnd = reader.statistics?.messageEndTime ?? recordingStart;
  const rows = useMemo(() => getTopicRows(reader), [reader]);

  // The range is shared with the timeline's trim handles.
  const clampNs = (ns: bigint) =>
    ns < recordingStart ? recordingStart : ns > recordingEnd ? recordingEnd : ns;
  const startNs = clampNs(useTrimStore((state) => state.start) ?? recordingStart);
  const endNs = clampNs(useTrimStore((state) => state.end) ?? recordingEnd);
  const setRange = useTrimStore((state) => state.setRange);
  // Bumped to reset a range field after invalid input.
  const [rangeFieldKey, setRangeFieldKey] = useState(0);
  const [filter, setFilter] = useState("");
  const [edits, setEdits] = useState<ReadonlyMap<string, TopicEdit>>(
    () => new Map(rows.map((row) => [row.topic, { keep: true, rename: "", everyNth: 1 }])),
  );
  const [compression, setCompression] = useState<ExportCompression>("zstd");
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);

  const [busy, setBusy] = useState(false);
  // Progress lives in a ref and is shown by <ExportProgress>, so the form (with its large
  // topic table) doesn't re-render for every chunk.
  const progressRef = useRef<number | undefined>();
  const [result, setResult] = useState<{ messageCount?: number; error?: string }>();
  const abortRef = useRef<AbortController | undefined>();

  // Start the workers (and their WASM) while the user is still choosing options.
  const [pool] = useState(createChunkWorkerPool);
  // Closing the dialog any way (Escape, backdrop) cancels a running export.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      pool.terminate();
    },
    [pool],
  );

  /** Commits a range field typed as seconds from the recording start. */
  const commitSeconds = (which: "start" | "end", text: string) => {
    const seconds = Number(text);
    if (text.trim() === "" || !Number.isFinite(seconds)) {
      setRangeFieldKey((key) => key + 1);
      return;
    }
    const ns = clampNs(recordingStart + BigInt(Math.round(seconds * NS_PER_SEC)));
    if (which === "start") {
      setRange(ns, ns > endNs ? ns : endNs);
    } else {
      setRange(ns < startNs ? ns : startNs, ns);
    }
  };

  const topics = useMemo(() => toExportTopics(edits), [edits]);
  const duplicates = useMemo(() => findDuplicateOutputTopics(topics), [topics]);
  const visibleRows = rows.filter((row) => row.topic.toLowerCase().includes(filter.toLowerCase()));
  const exporting = busy;
  const canExport = topics.size > 0 && duplicates.size === 0 && !busy;

  const updateEdit = (topic: string, change: Partial<TopicEdit>) => {
    setEdits((prev) => new Map(prev).set(topic, { ...prev.get(topic)!, ...change }));
  };
  const setVisibleKeep = ({ keep }: { keep: boolean }) => {
    setEdits((prev) => {
      const next = new Map(prev);
      for (const row of visibleRows) {
        next.set(row.topic, { ...prev.get(row.topic)!, keep });
      }
      return next;
    });
  };
  const playheadNs = currentTime ? clampNs(toNanoSec(currentTime)) : undefined;

  const handleExport = async () => {
    setBusy(true);
    setResult(undefined);
    progressRef.current = undefined;
    let output;
    try {
      output = await openExportOutput(exportFileName(file.name));
    } catch (err) {
      setResult({ error: String(err) });
    }
    if (!output) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    progressRef.current = 0;
    try {
      const { messageCount } = await exportMcap(reader, readable, output.writable, {
        topics,
        startTime: startNs,
        endTime: endNs,
        includeAttachments,
        includeMetadata,
        compression,
        processChunk: pool.processChunk,
        concurrency: pool.concurrency,
        onProgress: (fraction) => {
          progressRef.current = fraction;
        },
        signal: controller.signal,
      });
      await output.close();
      setResult({ messageCount });
    } catch (err) {
      await output.abort().catch(() => {});
      progressRef.current = undefined;
      setResult({ error: controller.signal.aborted ? undefined : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <>
      <DialogContent>
        <Stack gap={2}>
          <Typography variant="subtitle2">
            {t("timeRange", {
              duration: toSecondsText(endNs - startNs),
              total: toSecondsText(recordingEnd - recordingStart),
            })}
          </Typography>
          <Stack direction="row" gap={2}>
            {(["start", "end"] as const).map((which) => (
              <TextField
                // Uncontrolled, so typing doesn't move the timeline until the value is committed.
                key={`${which}-${which === "start" ? startNs : endNs}-${rangeFieldKey}`}
                label={t(which)}
                type="number"
                size="small"
                defaultValue={toSecondsText((which === "start" ? startNs : endNs) - recordingStart)}
                disabled={exporting}
                onBlur={(event) => {
                  commitSeconds(which, event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitSeconds(which, (event.target as HTMLInputElement).value);
                  }
                }}
                slotProps={{
                  htmlInput: { step: 0.1 },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={t("setToPlayhead")}>
                          <span>
                            <IconButton
                              size="small"
                              aria-label={t("setToPlayhead")}
                              disabled={playheadNs == undefined || exporting}
                              onClick={() => {
                                commitSeconds(which, toSecondsText(playheadNs! - recordingStart));
                              }}
                            >
                              <MyLocationIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            ))}
          </Stack>

          <Stack direction="row" gap={1} alignItems="center">
            <TextField
              size="small"
              placeholder={t("filterTopics")}
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              className={classes.grow}
            />
            <Button
              size="small"
              disabled={exporting}
              onClick={() => {
                setVisibleKeep({ keep: true });
              }}
            >
              {t("selectAll")}
            </Button>
            <Button
              size="small"
              disabled={exporting}
              onClick={() => {
                setVisibleKeep({ keep: false });
              }}
            >
              {t("selectNone")}
            </Button>
            <Typography variant="body2" color="text.secondary" noWrap>
              {t("topicsSelected", { selected: topics.size, total: rows.length })}
            </Typography>
          </Stack>

          <TableContainer className={classes.table}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>{t("topic")}</TableCell>
                  <TableCell>{t("schema")}</TableCell>
                  <TableCell align="right">{t("messages")}</TableCell>
                  <TableCell>{t("renameTo")}</TableCell>
                  <TableCell>{t("everyNth")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleRows.map((row) => {
                  const edit = edits.get(row.topic)!;
                  const output = edit.rename.trim() || row.topic;
                  return (
                    <TableRow key={row.topic} hover>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={edit.keep}
                          disabled={exporting}
                          slotProps={{ input: { "aria-label": row.topic } }}
                          onChange={(_, keep) => {
                            updateEdit(row.topic, { keep });
                          }}
                        />
                      </TableCell>
                      <TableCell className={classes.wrap}>{row.topic}</TableCell>
                      <TableCell className={classes.wrap}>{row.schemaName}</TableCell>
                      <TableCell align="right">{row.messageCount.toLocaleString()}</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          variant="standard"
                          placeholder={row.topic}
                          value={edit.rename}
                          disabled={!edit.keep || exporting}
                          error={edit.keep && duplicates.has(output)}
                          onChange={(event) => {
                            updateEdit(row.topic, { rename: event.target.value });
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          variant="standard"
                          type="number"
                          value={edit.everyNth}
                          disabled={!edit.keep || exporting}
                          slotProps={{ htmlInput: { min: 1, step: 1 } }}
                          className={classes.everyNth}
                          onChange={(event) => {
                            updateEdit(row.topic, {
                              everyNth: parseEveryNth(event.target.value),
                            });
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          {topics.size === 0 && <Alert severity="warning">{t("noTopics")}</Alert>}
          {duplicates.size > 0 && (
            <Alert severity="error">
              {t("duplicateTopics", { topics: [...duplicates].join(", ") })}
            </Alert>
          )}

          <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
            <TextField
              select
              size="small"
              label={t("compression")}
              value={compression}
              disabled={exporting}
              onChange={(event) => {
                setCompression(event.target.value as ExportCompression);
              }}
              className={classes.compression}
            >
              <MenuItem value="zstd">zstd</MenuItem>
              <MenuItem value="none">{t("compressionNone")}</MenuItem>
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={includeAttachments}
                  disabled={exporting}
                  onChange={(_, checked) => {
                    setIncludeAttachments(checked);
                  }}
                />
              }
              label={t("includeAttachments")}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={includeMetadata}
                  disabled={exporting}
                  onChange={(_, checked) => {
                    setIncludeMetadata(checked);
                  }}
                />
              }
              label={t("includeMetadata")}
            />
          </Stack>

          <ExportProgress progressRef={progressRef} running={busy} />
          {result?.messageCount != undefined && (
            <Alert severity="success">{t("done", { count: result.messageCount })}</Alert>
          )}
          {result?.error != undefined && <Alert severity="error">{result.error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{exporting ? t("cancel") : t("close")}</Button>
        <Button
          variant="contained"
          disabled={!canExport}
          onClick={() => {
            void handleExport();
          }}
        >
          {exporting ? t("exporting") : t("export")}
        </Button>
      </DialogActions>
    </>
  );
}

function ExportProgress({
  progressRef,
  running,
}: {
  progressRef: React.RefObject<number | undefined>;
  running: boolean;
}): React.JSX.Element | ReactNull {
  const [progress, setProgress] = useState(progressRef.current);
  useEffect(() => {
    setProgress(progressRef.current);
    if (!running) {
      return;
    }
    const interval = setInterval(() => {
      setProgress(progressRef.current);
    }, 100);
    return () => {
      clearInterval(interval);
    };
  }, [progressRef, running]);
  return progress == undefined ? (
    ReactNull
  ) : (
    <LinearProgress variant="determinate" value={Math.min(100, progress * 100)} />
  );
}
