// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { Time } from "@lichtblick/rostime";
import { Header } from "@lichtblick/suite-base/types/Messages";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

export type DiagnosticStatusConfig = {
  selectedHardwareId?: string;
  selectedName?: string;
  splitFraction?: number;
  /** Topics to read; undefined = every DiagnosticArray topic. */
  topics?: string[];
  /** Legacy single-topic config from older layouts; read as `topics: [topicToRender]`. */
  topicToRender?: string;
  numericPrecision?: number;
  secondsUntilStale?: number;
};

export type DiagnosticStatusPanelProps = {
  config: DiagnosticStatusConfig;
  saveConfig: SaveConfig<DiagnosticStatusConfig>;
};

export interface ToString {
  toString(): string;
}

export type DiagnosticId = string & ToString;

export type KeyValue = { key: string; value: string };

// diagnostic_msgs/DiagnosticStatus
export type DiagnosticStatusMessage = {
  name: string;
  hardware_id: string;
  level: number;
  message: string;
  values: KeyValue[];
};

export type DiagnosticInfo = {
  status: DiagnosticStatusMessage;
  /** header.stamp of the message, i.e. the publisher's clock */
  stamp: Time;
  /** player receive time; used for staleness and history so wrong robot clocks don't matter */
  receiveTime: Time;
  topic: string;
  id: DiagnosticId;
  displayName: string;
};

export type DiagnosticStatusArrayMsg = {
  header: Header;
  status: DiagnosticStatusMessage[];
};

export type FormattedKeyValue = {
  key: string;
  keyHtml: { __html: string } | undefined;
  value: string;
  valueHtml: { __html: string } | undefined;
};
