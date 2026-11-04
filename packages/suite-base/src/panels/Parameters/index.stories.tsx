// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useState } from "react";
import { StoryObj } from "storybook-react-rsbuild";

import { ParameterValue } from "@lichtblick/suite";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";

import Parameters from "./index";
import { parametersToYaml } from "./utils";

const DEFAULT_PARAMS = new Map<string, ParameterValue>([
  ["undefined", undefined],
  ["boolean", false],
  ["number", -42],
  ["string", "Hello, world!"],
  ["date", new Date(1618876820517)],
  ["Uint8Array", new Uint8Array([0, 1])],
  ["array", [1, 2]],
  ["string array", ["one", "two", "three"]],
  ["struct", { a: 1, b: [2, 3], c: "String value" }],
]);

const getFixture = ({
  getParameters,
  setParameters,
  parameters,
  setParameterValues,
}: {
  getParameters: boolean;
  setParameters: boolean;
  parameters?: Map<string, ParameterValue>;
  setParameterValues?: (params: Map<string, ParameterValue>) => void;
}) => {
  const capabilities: string[] = [];
  if (getParameters) {
    capabilities.push(PLAYER_CAPABILITIES.getParameters);
  }
  if (setParameters) {
    capabilities.push(PLAYER_CAPABILITIES.setParameters);
  }

  return {
    topics: [],
    frame: {},
    capabilities,
    activeData: {
      parameters: getParameters ? parameters : undefined,
    },
    setParameter:
      setParameters && setParameterValues
        ? (key: string, value: ParameterValue) => {
            const params = new Map<string, ParameterValue>(parameters);
            params.set(key, value);
            setParameterValues(params);
          }
        : undefined,
  };
};

export default {
  title: "panels/Parameters",
  component: Parameters,
};

export const Default: StoryObj = {
  render: () => {
    return (
      <PanelSetup fixture={getFixture({ getParameters: false, setParameters: false })}>
        <Parameters />
      </PanelSetup>
    );
  },
};

export const WithParameters: StoryObj = {
  render: () => {
    return (
      <PanelSetup
        fixture={getFixture({
          getParameters: true,
          setParameters: false,
          parameters: DEFAULT_PARAMS,
        })}
      >
        <Parameters />
      </PanelSetup>
    );
  },
};

const EditableParameters = () => {
  const [parameters, setParameterValues] = useState(DEFAULT_PARAMS);

  return (
    <PanelSetup
      fixture={getFixture({
        getParameters: true,
        setParameters: true,
        parameters,
        setParameterValues,
      })}
    >
      <Parameters />
    </PanelSetup>
  );
};

export const WithEditableParameters: StoryObj = {
  render: () => <EditableParameters />,
};

const NAMESPACED_PARAMS = new Map<string, ParameterValue>([
  ...DEFAULT_PARAMS,
  ...Array.from({ length: 2000 }, (_, i): [string, ParameterValue] => [
    `/robot/joint_${i % 20}/${["kp", "ki", "kd", "limit"][i % 4]}_${i}`,
    i % 3 === 0 ? i / 7 : i,
  ]),
  ["camera_node.exposure.auto", true],
  ["camera_node.exposure.value", 12.5],
  ["camera_node.frame_id", "camera"],
]);

const NamespacedParameters = () => {
  const [parameters, setParameterValues] = useState(NAMESPACED_PARAMS);
  const snapshot = new Map(NAMESPACED_PARAMS);
  snapshot.set("camera_node.exposure.value", 20);
  snapshot.set("/removed", "old");
  snapshot.delete("camera_node.frame_id");

  return (
    <PanelSetup
      fixture={getFixture({
        getParameters: true,
        setParameters: true,
        parameters,
        setParameterValues,
      })}
    >
      <Parameters
        overrideConfig={{
          snapshots: [{ name: "baseline", yaml: parametersToYaml(snapshot) }],
        }}
      />
    </PanelSetup>
  );
};

export const WithNamespacesAndSnapshot: StoryObj = {
  render: () => <NamespacedParameters />,
};
