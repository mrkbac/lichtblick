// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { Fragment, ReactNode, useCallback, useRef } from "react";

import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  PanelStateStore,
  usePanelStateStore,
} from "@lichtblick/suite-base/context/PanelStateContext";

/**
 * Wrapper component used to force-remount the panel when its settings sequence number changes,
 * or when its config was replaced by something other than the panel itself (undo, redo, loading
 * another layout). Many panels read their config only on mount, so they'd keep showing the old
 * config and write it back on their next save.
 */
export function PanelRemounter({
  children,
  id,
}: {
  children: ReactNode;
  id: string;
}): React.JSX.Element {
  const selector = useCallback((store: PanelStateStore) => store.sequenceNumbers[id] ?? 0, [id]);
  const sequenceNumber = usePanelStateStore(selector);

  const { getCurrentLayoutState } = useCurrentLayoutActions();
  const config = useCurrentLayoutSelector(
    useCallback((state: LayoutState) => state.selectedLayout?.data?.configById[id], [id]),
  );
  const seen = useRef({ config, remounts: 0 });
  if (config !== seen.current.config) {
    // Deep compare: a layout load hands every panel new objects, often with the same content.
    // A panel the new layout no longer has (e.g. undoing its Add Panel) is about to unmount:
    // remounting it would only let it save its defaults into the restored step.
    if (
      config != undefined &&
      getCurrentLayoutState().selectedLayout?.externalEdit === true &&
      !_.isEqual(config, seen.current.config)
    ) {
      seen.current.remounts++;
    }
    seen.current.config = config;
  }

  return <Fragment key={`${id}${sequenceNumber}:${seen.current.remounts}`}>{children}</Fragment>;
}
