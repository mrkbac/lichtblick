// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AccordionDetails } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { WsMixedContentHelp } from "@lichtblick/suite-base/components/WsMixedContentHelp";
import { PlayerAlertGuide } from "@lichtblick/suite-base/players/types";
import { DetailsType } from "@lichtblick/suite-base/util/sendNotification";

import { useStyles } from "./AlertsList.style";

export function AlertDetails(
  props: Readonly<{ details: DetailsType; tip?: string; guide?: PlayerAlertGuide }>,
): React.JSX.Element {
  const { t } = useTranslation("alertsList");
  const { details, tip, guide } = props;
  const { classes } = useStyles();

  const content = useMemo((): React.ReactNode => {
    if (details instanceof Error) {
      return details.message;
    } else if (details != undefined && details !== "") {
      return details;
    }
    return undefined;
  }, [details]);
  const hasTip = tip != undefined && tip !== "";
  const hasContent = content != undefined;
  return (
    <AccordionDetails className={classes.accordionDetails}>
      {guide?.type === "wsMixedContent" ? (
        <WsMixedContentHelp url={guide.url} />
      ) : (
        hasTip && <div className={classes.detailsText}>{tip}</div>
      )}
      {hasContent && <div className={classes.detailsText}>{content}</div>}
      {guide == undefined && !hasTip && !hasContent && t("noDetailsProvided")}
    </AccordionDetails>
  );
}
