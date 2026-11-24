// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// <ws/>, <url/>, <ext/>… are inline code snippets; <b> is bold.
export const wsMixedContent = {
  dialogTitle: "Your browser blocked the connection",
  close: "Close",
  copy: "Copy {{text}}",
  intro:
    "Browsers only allow unencrypted <ws/> connections from an https page to localhost, so <url/> was blocked. Use one of these, then reload the page.",
  extensionHeading: "Recommended: install the Digitalis proxy extension",
  downloadExtension: "Download the extension",
  unzip: "and unzip it.",
  openExtensions: "Open <page/> and turn on <b>Developer mode</b>.",
  loadUnpacked: "Click <b>Load unpacked</b> and pick the unzipped <folder/> folder.",
  extensionNote:
    "Needs Chrome, Edge or another Chromium browser, version 140 or newer. It runs only on this site, asks for no permissions and relays only ws:// connections.",
  extensionElsewhere:
    "The Digitalis proxy extension runs on <site/> only. Open this connection there to use it.",
  allowHeading: "Allow insecure content for this site",
  orAllowHeading: "Or allow insecure content for this site",
  chromiumSetting:
    "Open <page/> and set <b>Insecure content</b> to <b>Allow</b>. The browser then marks this site as “Not secure”.",
  firefoxSetting: "Open <page/> and set <pref/> to <b>true</b>. This applies to every site.",
  noSetting:
    "This browser has no setting for it. Use Chrome or Edge with the extension, or wss://.",
  wss: "Or serve the connection over <wss/> (TLS), for example behind a reverse proxy.",
  reload: "Reload and retry",
};
