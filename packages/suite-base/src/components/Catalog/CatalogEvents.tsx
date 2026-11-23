// SPDX-License-Identifier: MPL-2.0

import { compare, type Time } from "@foxglove/rostime";
import { Alert, ListItemButton, ListItemText, Typography } from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Stack from "@lichtblick/suite-base/components/Stack";
import { format, formatDurationCompact } from "@lichtblick/suite-base/util/formatTime";
import { isAbsoluteTime } from "@lichtblick/suite-base/util/time";

import { CatalogRecording } from "./types";

const useStyles = makeStyles()((theme) => ({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  scroll: { flex: 1, overflow: "auto" },
  row: { position: "absolute", top: 0, width: "100%", height: 54, gap: theme.spacing(2) },
}));

export function formatCatalogTime(time: Time): string {
  return isAbsoluteTime(time) ? format(time) : formatDurationCompact(time);
}

export function CatalogEvents({
  recordings,
  query,
  selectedId,
  onSelect,
}: {
  recordings: readonly CatalogRecording[];
  query: string;
  selectedId?: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation("catalog");
  const { classes } = useStyles();
  const scroll = useRef<HTMLDivElement>(null);
  const events = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return recordings
      .flatMap((recording) =>
        (recording.events ?? []).map((event, index) => ({
          event,
          recording,
          index,
        })),
      )
      .filter(
        ({ event, recording }) =>
          event.name.toLocaleLowerCase().includes(term) ||
          recording.name.toLocaleLowerCase().includes(term),
      )
      .sort((a, b) => compare(b.event.start, a.event.start));
  }, [recordings, query]);
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 54,
    overscan: 8,
  });

  return (
    <Stack className={classes.root} gap={1}>
      {recordings.some((r) => r.eventsError === true) && (
        <Alert severity="warning">{t("eventsReadError")}</Alert>
      )}
      {recordings.some((r) => r.eventsTruncated === true) && (
        <Alert severity="info">{t("eventsTruncated")}</Alert>
      )}
      <div className={classes.scroll} ref={scroll}>
        {events.length === 0 && <Typography color="textSecondary">{t("noEvents")}</Typography>}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const { event, recording, index } = events[row.index]!;
            return (
              <ListItemButton
                key={JSON.stringify([recording.id, index])}
                className={classes.row}
                style={{ transform: `translateY(${row.start}px)` }}
                selected={selectedId === recording.id}
                onClick={() => {
                  onSelect(recording.id);
                }}
              >
                <ListItemText
                  primary={event.name}
                  secondary={recording.name}
                  slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                />
                <Typography variant="body2" color="textSecondary">
                  {formatCatalogTime(event.start)}
                  {event.end &&
                    compare(event.start, event.end) !== 0 &&
                    ` – ${formatCatalogTime(event.end)}`}
                </Typography>
              </ListItemButton>
            );
          })}
        </div>
      </div>
    </Stack>
  );
}
