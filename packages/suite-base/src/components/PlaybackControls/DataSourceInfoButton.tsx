// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Info20Filled, Info20Regular } from "@fluentui/react-icons";
import { Popover } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { DataSourceInfoView } from "@lichtblick/suite-base/components/DataSourceInfoView";
import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";

const useStyles = makeStyles()((theme) => ({
  paper: {
    padding: theme.spacing(1.5, 2),
    width: 340,
    maxHeight: "60vh",
    overflowY: "auto",
  },
}));

/** Info button in the playback bar that opens a summary of the data source on click. */
export function DataSourceInfoButton({ disabled }: { disabled: boolean }): React.JSX.Element {
  const { t } = useTranslation("dataSourceInfo");
  const { classes } = useStyles();
  const [anchor, setAnchor] = useState<HTMLElement | undefined>();

  return (
    <>
      <HoverableIconButton
        size="small"
        title={t("dataSource")}
        aria-label={t("dataSource")}
        aria-expanded={anchor != undefined}
        disabled={disabled}
        icon={anchor ? <Info20Filled /> : <Info20Regular />}
        activeIcon={<Info20Filled />}
        onClick={(event) => {
          setAnchor(event.currentTarget);
        }}
      />
      <Popover
        open={anchor != undefined}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(undefined);
        }}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { className: classes.paper } }}
      >
        <DataSourceInfoView disableSource />
      </Popover>
    </>
  );
}
