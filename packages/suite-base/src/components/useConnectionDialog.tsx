// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef, useState } from "react";

import type { IDataSourceFactory } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import type { LiveConnectionBackend } from "@lichtblick/suite-base/players/LiveConnectionBackend";

type Dialog = NonNullable<IDataSourceFactory["ConnectionDialog"]>;
type Connection = { url: string; transport: LiveConnectionBackend };

export function useConnectionDialog(): {
  dialog: React.JSX.Element | undefined;
  prompt: (DialogComponent: Dialog, initialUrl?: string) => Promise<Connection | undefined>;
  dismiss: () => void;
} {
  const [dialog, setDialog] = useState<React.JSX.Element>();
  const nextDialogKey = useRef(0);
  const pending = useRef<((result?: Connection) => void) | undefined>(undefined);
  const dismiss = useCallback(() => {
    pending.current?.();
    pending.current = undefined;
    setDialog(undefined);
  }, []);
  useEffect(
    () => () => {
      pending.current?.();
      pending.current = undefined;
    },
    [],
  );
  const prompt = useCallback(async (DialogComponent: Dialog, initialUrl?: string) => {
    return await new Promise<Connection | undefined>((resolve) => {
      pending.current?.();
      pending.current = resolve;
      const finish = (result?: Connection) => {
        if (pending.current !== resolve) {
          result?.transport.dispose?.();
          return;
        }
        pending.current = undefined;
        setDialog(undefined);
        resolve(result);
      };
      setDialog(
        <DialogComponent
          key={++nextDialogKey.current}
          initialUrl={initialUrl}
          onCancel={() => {
            finish();
          }}
          onConnect={(url, transport) => {
            finish({ url, transport });
          }}
        />,
      );
    });
  }, []);
  return { dialog, prompt, dismiss };
}
