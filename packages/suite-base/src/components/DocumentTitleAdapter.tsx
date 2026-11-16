// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";

import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { selectPlayerName } from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";

/**
 * DocumentTitleAdapter sets the document title based on the currently selected player
 */
export default function DocumentTitleAdapter(): React.JSX.Element {
  const playerName = useMessagePipeline(selectPlayerName);

  useEffect(() => {
    if (!playerName) {
      window.document.title = APP_CONFIG.productName;
      return;
    }
    window.document.title = navigator.userAgent.includes("Mac")
      ? playerName
      : `${playerName} – ${APP_CONFIG.productName}`;
  }, [playerName]);

  return <></>;
}
