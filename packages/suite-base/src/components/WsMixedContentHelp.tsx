// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ArrowClockwise16Regular, ArrowDownload16Regular } from "@fluentui/react-icons";
import { Button, Link, Typography } from "@mui/material";
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
  return (
    <>
      <code className={classes.code}>{text}</code>
      {copy && (
        <CopyButton
          size="small"
          iconSize="small"
          color="inherit"
          title={`Copy ${text}`}
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
export function WsMixedContentHelp({ url }: { url: string }): React.JSX.Element {
  const { classes } = useStyles();
  const browser = detectBrowser();
  const origin = window.location.origin;
  const chromiumBased = browser === "chromium" || browser === "edge";
  const extensionRunsHere = PROXY_ORIGINS.has(origin);
  const settingsScheme = browser === "edge" ? "edge" : "chrome";

  return (
    <Stack gap={1.5} className={classes.root}>
      <Typography variant="inherit">
        Browsers only allow unencrypted <Code text="ws://" /> connections from an https page to
        localhost, so <Code text={url} /> was blocked. Use one of these, then reload the page.
      </Typography>

      {chromiumBased && extensionRunsHere && (
        <Stack gap={0.5}>
          <Typography variant="inherit" className={classes.heading}>
            Recommended: install the Licht WebSocket proxy extension
          </Typography>
          <ol className={classes.steps}>
            <li>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArrowDownload16Regular />}
                href="/licht-ws-proxy.zip"
                target="_self"
                download
              >
                Download the extension
              </Button>{" "}
              and unzip it.
            </li>
            <li>
              Open <Code text={`${settingsScheme}://extensions`} copy /> and turn on{" "}
              <b>Developer mode</b>.
            </li>
            <li>
              Click <b>Load unpacked</b> and pick the unzipped <Code text="licht-ws-proxy" />{" "}
              folder.
            </li>
          </ol>
          <Typography variant="inherit" color="text.secondary">
            Needs Chrome, Edge or another Chromium browser, version 140 or newer. It runs only on
            this site, asks for no permissions and relays only ws:// connections.
          </Typography>
        </Stack>
      )}
      {chromiumBased && !extensionRunsHere && (
        <Typography variant="inherit">
          The Licht WebSocket proxy extension runs on{" "}
          <Link href={[...PROXY_ORIGINS][0]} target="_blank" rel="noreferrer">
            {[...PROXY_ORIGINS][0]}
          </Link>{" "}
          only. Open this connection there to use it.
        </Typography>
      )}

      <Stack gap={0.5}>
        <Typography variant="inherit" className={classes.heading}>
          {chromiumBased && extensionRunsHere ? "Or allow" : "Allow"} insecure content for this site
        </Typography>
        {chromiumBased && (
          <Typography variant="inherit">
            Open{" "}
            <Code
              text={`${settingsScheme}://settings/content/siteDetails?site=${encodeURIComponent(origin)}`}
              copy
            />{" "}
            and set <b>Insecure content</b> to <b>Allow</b>. The browser then marks this site as
            &ldquo;Not secure&rdquo;.
          </Typography>
        )}
        {browser === "firefox" && (
          <Typography variant="inherit">
            Open <Code text="about:config" copy /> and set{" "}
            <Code text="network.websocket.allowInsecureFromHTTPS" copy /> to <b>true</b>. This
            applies to every site.
          </Typography>
        )}
        {(browser === "safari" || browser === "other") && (
          <Typography variant="inherit">
            This browser has no setting for it. Use Chrome or Edge with the extension, or wss://.
          </Typography>
        )}
      </Stack>

      <Typography variant="inherit">
        Or serve the connection over <Code text="wss://" /> (TLS), for example behind a reverse
        proxy.
      </Typography>

      <div>
        <Button
          size="small"
          variant="contained"
          startIcon={<ArrowClockwise16Regular />}
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload and retry
        </Button>
      </div>
    </Stack>
  );
}
