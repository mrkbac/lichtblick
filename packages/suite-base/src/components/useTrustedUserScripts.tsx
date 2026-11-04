// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";

import Logger from "@lichtblick/log";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import { layoutIsShared } from "@lichtblick/suite-base/services/ILayoutStorage";
import { UserScripts } from "@lichtblick/suite-base/types/panels";

const log = Logger.getLogger(__filename);

const APPROVALS_KEY = "lichtblick.trustedUserScripts";
const MAX_APPROVALS = 500;
const NO_SCRIPTS: UserScripts = Object.freeze({});

/** Stable text of a script set, so the same scripts always compare equal. */
function canonical(scripts: UserScripts): string {
  return (
    JSON.stringify(
      Object.entries(scripts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, script]) => [id, script.name, script.sourceCode]),
    ) ?? ""
  );
}

/** Undefined where WebCrypto is unavailable (insecure origins): then nothing is remembered. */
async function approvalKey(layoutId: string, scripts: string): Promise<string | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (globalThis.crypto?.subtle == undefined) {
    return undefined;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scripts));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${layoutId}:${hex}`;
}

function readApprovals(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(APPROVALS_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function isApproved(layoutId: string, scripts: string): Promise<boolean> {
  const key = await approvalKey(layoutId, scripts);
  return key != undefined && readApprovals().includes(key);
}

async function approve(layoutId: string, scripts: string): Promise<void> {
  const key = await approvalKey(layoutId, scripts);
  if (key == undefined) {
    return;
  }
  const approvals = [...readApprovals().filter((k) => k !== key), key].slice(-MAX_APPROVALS);
  try {
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(approvals) ?? "[]");
  } catch (error) {
    log.warn("Could not remember trusted user scripts", error);
  }
}

type Decision = { layoutId: string; scripts: string };

/**
 * User scripts run code from the layout. Scripts in a shared layout can come from anyone who can
 * edit it, so they only run after the user agrees, once per version of the scripts. Scripts in
 * local layouts, and the user's own edits to scripts they already allowed, run as before.
 *
 * Returns the scripts to run (none until allowed) and the dialog to render.
 */
export function useTrustedUserScripts({
  layoutId,
  userScripts,
  edited,
}: {
  layoutId: string | undefined;
  userScripts: UserScripts;
  /** Whether the open layout has unsaved local changes. */
  edited: boolean;
}): { scripts: UserScripts; prompt: React.JSX.Element | undefined } {
  const layoutManager = useLayoutManager();
  const scriptsText = useMemo(() => canonical(userScripts), [userScripts]);
  const hasScripts = Object.keys(userScripts).length > 0;

  const [layoutInfo, setLayoutInfo] = useState<{ id: string; shared: boolean }>();
  const [allowed, setAllowed] = useState<Decision>();
  const [declined, setDeclined] = useState<Decision>();
  const [pending, setPending] = useState<Decision & { names: string[] }>();
  /** The last layout whose scripts the user allowed, so their own edits keep running. */
  const allowedLayoutRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (layoutId == undefined) {
      return;
    }
    const controller = new AbortController();
    void layoutManager.getLayout(layoutId as never).then((layout) => {
      if (!controller.signal.aborted) {
        setLayoutInfo({ id: layoutId, shared: layout != undefined && layoutIsShared(layout) });
      }
    });
    return () => {
      controller.abort();
    };
  }, [layoutId, layoutManager]);

  const known = layoutId != undefined && layoutInfo?.id === layoutId;
  const needsTrust = hasScripts && known && layoutInfo.shared;
  const isAllowed =
    allowed != undefined && allowed.layoutId === layoutId && allowed.scripts === scriptsText;
  const isDeclined =
    declined != undefined && declined.layoutId === layoutId && declined.scripts === scriptsText;

  useEffect(() => {
    if (!needsTrust || isAllowed || isDeclined) {
      setPending(undefined);
      return;
    }
    const controller = new AbortController();
    const allow = () => {
      allowedLayoutRef.current = layoutId;
      setAllowed({ layoutId, scripts: scriptsText });
      setPending(undefined);
    };
    void (async () => {
      // Scripts that change while the user edits an allowed layout are the user's own changes.
      if (edited && allowedLayoutRef.current === layoutId) {
        await approve(layoutId, scriptsText);
      } else if (!(await isApproved(layoutId, scriptsText))) {
        if (!controller.signal.aborted) {
          setPending({
            layoutId,
            scripts: scriptsText,
            names: Object.values(userScripts).map((script) => script.name),
          });
        }
        return;
      }
      if (!controller.signal.aborted) {
        allow();
      }
    })();
    return () => {
      controller.abort();
    };
  }, [edited, isAllowed, isDeclined, layoutId, needsTrust, scriptsText, userScripts]);

  let scripts = NO_SCRIPTS;
  if (hasScripts && known && (!layoutInfo.shared || isAllowed)) {
    scripts = userScripts;
  }

  const prompt = pending?.layoutId === layoutId && pending != undefined && (
    <Dialog open maxWidth="sm" fullWidth data-testid="trust-user-scripts">
      <DialogTitle>Run user scripts from this shared layout?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          This layout contains {pending.names.length === 1 ? "a user script" : "user scripts"}:{" "}
          {pending.names.join(", ")}. User scripts run code in your browser and can change the data
          you see. Anyone who can edit this layout in your organization can change them. Only run
          them if you trust those people.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button
          variant="outlined"
          color="inherit"
          onClick={() => {
            setDeclined({ layoutId: pending.layoutId, scripts: pending.scripts });
            setPending(undefined);
          }}
        >
          Don’t run
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            const decision = { layoutId: pending.layoutId, scripts: pending.scripts };
            void approve(decision.layoutId, decision.scripts);
            allowedLayoutRef.current = decision.layoutId;
            setAllowed(decision);
            setPending(undefined);
          }}
        >
          Run scripts
        </Button>
      </DialogActions>
    </Dialog>
  );

  return { scripts, prompt: prompt === false ? undefined : prompt };
}
