// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button } from "@mui/material";

import {
  ExtensionActionButtonProps,
  ExtensionActionsLabel,
  ExtensionOperationStatusLabel,
} from "@lichtblick/suite-base/components/ExtensionsSettings/types";
import { OperationStatus } from "@lichtblick/suite-base/components/types";
import { canInstallExtension } from "@lichtblick/suite-base/util/canInstallExtension";

/**
 * Install or uninstall button for an extension.
 * The install button only renders if the extension can be installed (has a foxe URL).
 */
export function ExtensionActionButton({
  extension,
  installed,
  onAction,
  isOperating,
  operationStatus,
}: Readonly<ExtensionActionButtonProps>): React.ReactElement | undefined {
  if (!installed && !canInstallExtension(extension)) {
    return undefined;
  }
  const label = installed ? ExtensionActionsLabel.UNINSTALL : ExtensionActionsLabel.INSTALL;
  const loadingLabel = installed
    ? ExtensionOperationStatusLabel.UNINSTALLING
    : ExtensionOperationStatusLabel.INSTALLING;
  return (
    <Button
      size="small"
      color={installed ? "inherit" : "primary"}
      variant="contained"
      onClick={async (event) => {
        event.stopPropagation();
        await onAction(extension);
      }}
      disabled={isOperating}
    >
      {isOperating && operationStatus !== OperationStatus.IDLE ? loadingLabel : label}
    </Button>
  );
}
