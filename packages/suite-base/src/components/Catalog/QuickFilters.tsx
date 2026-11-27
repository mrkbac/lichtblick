// SPDX-License-Identifier: MPL-2.0

import { Chip } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@lichtblick/suite-base/components/Stack";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks/useAppTimeFormat";

import { filterRecordings } from "./search";
import { CatalogRecording } from "./types";

/** Today's date (YYYY-MM-DD) in `timezone`; `since:` reads it as that day's start there. */
function today(timezone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

const FILTERS = [
  { label: "filterCamera", term: () => "has:image" },
  { label: "filterGps", term: () => "has:gps" },
  { label: "filterLidar", term: () => "has:pointcloud" },
  { label: "filterToday", term: (timezone?: string) => `since:${today(timezone)}` },
  { label: "filterLong", term: () => "duration>5m" },
  { label: "filterProblems", term: () => "status:error|nosummary" },
] as const;

const terms = (query: string) => query.trim().split(/\s+/).filter(Boolean);

/** Add `term` to the query, or remove it if it is already there. */
export function toggleTerm(query: string, term: string): string {
  const current = terms(query);
  return current.includes(term)
    ? current.filter((t) => t !== term).join(" ")
    : [...current, term].join(" ");
}

type Props = {
  recordings: readonly CatalogRecording[];
  query: string;
  onQueryChange: (query: string) => void;
};

/**
 * Chips that toggle common filters in the search query, so they combine with typed filters and the
 * query stays the one source of truth. A chip shows only when some recording in the folder matches.
 */
export function QuickFilters({ recordings, query, onQueryChange }: Props): React.JSX.Element {
  const { t } = useTranslation("catalog");
  const { timeZone } = useAppTimeFormat();
  const active = terms(query);
  const available = useMemo(
    () => [
      // One chip per machine live recordings came from, so a robot's sessions are one click away.
      ...[...new Set(recordings.flatMap((r) => (r.machine ? [r.machine] : [])))]
        .sort()
        .map((machine) => ({ key: machine, label: machine, term: `machine=${machine}` })),
      ...FILTERS.map((filter) => ({
        key: filter.label,
        label: t(filter.label),
        term: filter.term(timeZone),
      })).filter(({ term }) => filterRecordings(recordings, term, timeZone).length > 0),
    ],
    [recordings, t, timeZone],
  );
  return (
    <Stack direction="row" gap={1} flexWrap="wrap">
      {available.map(({ key, label, term }) => {
        const on = active.includes(term);
        return (
          <Chip
            key={key}
            size="small"
            label={label}
            color={on ? "primary" : "default"}
            variant={on ? "filled" : "outlined"}
            onClick={() => {
              onQueryChange(toggleTerm(query, term));
            }}
          />
        );
      })}
    </Stack>
  );
}
