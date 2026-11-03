// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Chip } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@lichtblick/suite-base/components/Stack";

import { filterRecordings } from "./search";
import { CatalogRecording } from "./types";

function startOfToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  // No time zone suffix, so it parses as local midnight.
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00`;
}

const FILTERS = [
  { label: "filterCamera", term: () => "has:image" },
  { label: "filterGps", term: () => "has:gps" },
  { label: "filterLidar", term: () => "has:pointcloud" },
  { label: "filterToday", term: () => `since:${startOfToday()}` },
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
  const active = terms(query);
  const available = useMemo(
    () =>
      FILTERS.map((filter) => ({ ...filter, term: filter.term() })).filter(
        ({ term }) => filterRecordings(recordings, term).length > 0,
      ),
    [recordings],
  );
  return (
    <Stack direction="row" gap={1} flexWrap="wrap">
      {available.map(({ label, term }) => {
        const on = active.includes(term);
        return (
          <Chip
            key={label}
            size="small"
            label={t(label)}
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
