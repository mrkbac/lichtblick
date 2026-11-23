// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Button, Link, Typography } from "@mui/material";
import { Trans, useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import CopyButton from "@lichtblick/suite-base/components/CopyButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { PROXY_ORIGINS } from "@lichtblick/suite-base/players/wsProxyOrigins";
import { fontMonospace } from "@lichtblick/theme";

const useStyles = makeStyles()((theme) => ({
  root: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: 1.5,
    color: theme.palette.text.primary,
    whiteSpace: "normal",
    maxWidth: 560,
  },
  heading: {
    fontWeight: 600,
  },
  steps: {
    margin: 0,
    paddingLeft: theme.spacing(2.5),
    "& > li": { marginBottom: theme.spacing(0.5) },
  },
  code: {
    fontFamily: fontMonospace,
    fontSize: "0.9em",
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.action.hover,
    wordBreak: "break-all",
  },
}));

type Browser = "chromium" | "edge" | "firefox" | "safari" | "other";

function detectBrowser(): Browser {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/\bEdg\//.test(ua)) {
    return "edge";
  }
  if (/\b(Chrome|Chromium)\//.test(ua)) {
    return "chromium";
  }
  if (/\bFirefox\//.test(ua)) {
    return "firefox";
  }
  if (/\bSafari\//.test(ua)) {
    return "safari";
  }
  return "other";
}

function Code({ text, copy = false }: { text: string; copy?: boolean }): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("wsMixedContent");
  return (
    <>
      <code className={classes.code}>{text}</code>
      {copy && (
        <CopyButton
          size="small"
          iconSize="small"
          color="inherit"
          title={t("copy", { text })}
          getText={() => text}
        />
      )}
    </>
  );
}

/**
 * What to do when the browser blocks a ws:// connection from this https page: the WebSocket proxy
 * extension (preferred), the per-browser "insecure content" setting, or wss://, and a reload.
 */
export default function WsMixedContentHelp({ url }: { url: string }): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("wsMixedContent");
  const browser = detectBrowser();
  const origin = window.location.origin;
  const chromiumBased = browser === "chromium" || browser === "edge";
  const extensionRunsHere = PROXY_ORIGINS.has(origin);
  const settingsScheme = browser === "edge" ? "edge" : "chrome";
  const extensionSite = [...PROXY_ORIGINS][0]!;

  return (
    <Stack gap={1.5} className={classes.root}>
      <Typography variant="inherit">
        <Trans
          t={t}
          i18nKey="intro"
          components={{ ws: <Code text="ws://" />, url: <Code text={url} /> }}
        />
      </Typography>

      {chromiumBased && extensionRunsHere && (
        <Stack gap={0.5}>
          <Typography variant="inherit" className={classes.heading}>
            {t("extensionHeading")}
          </Typography>
          <ol className={classes.steps}>
            <li>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileDownloadOutlinedIcon style={{ fontSize: 16 }} />}
                href="/licht-ws-proxy.zip"
                target="_self"
                download
              >
                {t("downloadExtension")}
              </Button>{" "}
              {t("unzip")}
            </li>
            <li>
              <Trans
                t={t}
                i18nKey="openExtensions"
                components={{
                  page: <Code text={`${settingsScheme}://extensions`} copy />,
                  b: <b />,
                }}
              />
            </li>
            <li>
              <Trans
                t={t}
                i18nKey="loadUnpacked"
                components={{ folder: <Code text="licht-ws-proxy" />, b: <b /> }}
              />
            </li>
          </ol>
          <Typography variant="inherit" color="text.secondary">
            {t("extensionNote")}
          </Typography>
        </Stack>
      )}
      {chromiumBased && !extensionRunsHere && (
        <Typography variant="inherit">
          <Trans
            t={t}
            i18nKey="extensionElsewhere"
            components={{
              site: (
                <Link href={extensionSite} target="_blank" rel="noreferrer">
                  {extensionSite}
                </Link>
              ),
            }}
          />
        </Typography>
      )}

      <Stack gap={0.5}>
        <Typography variant="inherit" className={classes.heading}>
          {t(chromiumBased && extensionRunsHere ? "orAllowHeading" : "allowHeading")}
        </Typography>
        {chromiumBased && (
          <Typography variant="inherit">
            <Trans
              t={t}
              i18nKey="chromiumSetting"
              components={{
                page: (
                  <Code
                    text={`${settingsScheme}://settings/content/siteDetails?site=${encodeURIComponent(origin)}`}
                    copy
                  />
                ),
                b: <b />,
              }}
            />
          </Typography>
        )}
        {browser === "firefox" && (
          <Typography variant="inherit">
            <Trans
              t={t}
              i18nKey="firefoxSetting"
              components={{
                page: <Code text="about:config" copy />,
                pref: <Code text="network.websocket.allowInsecureFromHTTPS" copy />,
                b: <b />,
              }}
            />
          </Typography>
        )}
        {(browser === "safari" || browser === "other") && (
          <Typography variant="inherit">{t("noSetting")}</Typography>
        )}
      </Stack>

      <Typography variant="inherit">
        <Trans t={t} i18nKey="wss" components={{ wss: <Code text="wss://" /> }} />
      </Typography>

      <div>
        <Button
          size="small"
          variant="contained"
          startIcon={<RefreshIcon style={{ fontSize: 16 }} />}
          onClick={() => {
            window.location.reload();
          }}
        >
          {t("reload")}
        </Button>
      </div>
    </Stack>
  );
}
