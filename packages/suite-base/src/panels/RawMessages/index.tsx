// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import Panel from "@lichtblick/suite-base/components/Panel";
import { PropsRawMessagesVirtual } from "@lichtblick/suite-base/panels/RawMessagesCommon/types";
import RawMessagesVirtual from "@lichtblick/suite-base/panels/RawMessagesVirtual/RawMessagesVirtual";
import { RAW_MESSAGES_VIRTUAL_DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/RawMessagesVirtual/constants";

// Raw Messages uses the virtualized tree. The "RawMessagesVirtual" panel type is kept as an
// alias so layouts saved with it keep working.
function RawMessages(props: PropsRawMessagesVirtual): React.JSX.Element {
  return <RawMessagesVirtual {...props} />;
}

export default Panel(
  Object.assign(RawMessages, {
    panelType: "RawMessages",
    defaultConfig: RAW_MESSAGES_VIRTUAL_DEFAULT_CONFIG,
  }),
);
