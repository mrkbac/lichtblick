// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from "@mui/material";
import { useCallback, useRef, useState } from "react";

import { Schemas } from "@lichtblick/suite-base/api/organization/client";
import Stack from "@lichtblick/suite-base/components/Stack";

type ShareResult = { name: string; organizationId: string };

type OpenParams = { initialName: string; organizations: Schemas["Organization"][] };

/**
 * Asks for a layout name and the organization to save a copy in. Every organization is listed,
 * those without `layouts:write` disabled, and none is preselected.
 */
export function useShareLayoutDialog(): [
  React.JSX.Element | undefined,
  (params: OpenParams) => Promise<ShareResult | undefined>,
] {
  const [params, setParams] = useState<OpenParams>();
  const [name, setName] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const resolveRef = useRef<(result: ShareResult | undefined) => void>();

  const open = useCallback(async (openParams: OpenParams) => {
    setParams(openParams);
    setName(openParams.initialName);
    setOrganizationId("");
    return await new Promise<ShareResult | undefined>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const close = (result: ShareResult | undefined) => {
    resolveRef.current?.(result);
    resolveRef.current = undefined;
    setParams(undefined);
  };

  const trimmedName = name.trim();
  const canShare = trimmedName.length > 0 && organizationId !== "";

  const modal = params && (
    <Dialog
      open
      onClose={() => {
        close(undefined);
      }}
      maxWidth="xs"
      fullWidth
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canShare) {
            close({ name: trimmedName, organizationId });
          }
        }}
      >
        <DialogTitle>Share a copy</DialogTitle>
        <DialogContent>
          <Stack gap={2} paddingTop={1}>
            <TextField
              autoFocus
              label="Layout name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              fullWidth
            />
            <TextField
              select
              label="Organization"
              value={organizationId}
              onChange={(event) => {
                setOrganizationId(event.target.value);
              }}
              fullWidth
            >
              {params.organizations.map((org) => {
                const writable = org.permissions.includes("layouts:write");
                return (
                  <MenuItem key={org.id} value={org.id} disabled={!writable}>
                    {writable ? org.displayName : `${org.displayName} (read-only)`}
                  </MenuItem>
                );
              })}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => {
              close(undefined);
            }}
          >
            Cancel
          </Button>
          <Button variant="contained" type="submit" disabled={!canShare}>
            Share
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );

  return [modal, open];
}
