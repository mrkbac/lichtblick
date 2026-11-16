// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Cursor20Regular } from "@fluentui/react-icons";
import { Typography } from "@mui/material";
import React from "react";

import type { LayoutActions } from "@lichtblick/suite";
import ExpandingToolbar, {
  ToolGroup,
  ToolGroupFixedSizePane,
} from "@lichtblick/suite-base/components/ExpandingToolbar";

import ObjectDetails from "./ObjectDetails";
import TopicLink from "./TopicLink";
import { InteractionData } from "./types";
import { Pose } from "../transforms";

export const OBJECT_TAB_TYPE = "Selected object";
export type TabType = typeof OBJECT_TAB_TYPE;

export type SelectionObject = {
  object: {
    pose: Pose;
    interactionData?: InteractionData;
  };
  instanceIndex: number | undefined;
};

type Props = {
  addPanel: LayoutActions["addPanel"];
  interactionsTabType?: TabType;
  onShowTopicSettings?: (topic: string) => void;
  selectedObject?: SelectionObject;
  setInteractionsTabType: (arg0?: TabType) => void;
  timezone: string | undefined;
  /** The panel's other floating controls, shown in the same toolbar below the inspect button. */
  toolbarItems?: React.ReactNode;
};

type SelectedObjectPaneProps = Pick<
  Props,
  "addPanel" | "onShowTopicSettings" | "selectedObject" | "timezone"
>;

// Memoized on its own: the toolbar around it re-renders with the overlay (e.g. on every hover move),
// the object details only when the selection changes.
const SelectedObjectPane = React.memo<SelectedObjectPaneProps>(function SelectedObjectPane({
  addPanel,
  onShowTopicSettings,
  selectedObject,
  timezone,
}) {
  const selectedInteractionData = selectedObject?.object.interactionData;
  const originalMessage = selectedInteractionData?.originalMessage;
  const instanceDetails = selectedInteractionData?.instanceDetails;

  return (
    <ToolGroupFixedSizePane>
      {originalMessage ? (
        <>
          {selectedInteractionData.topic && (
            <TopicLink
              addPanel={addPanel}
              onShowTopicSettings={onShowTopicSettings}
              topic={selectedInteractionData.topic}
            />
          )}
          {instanceDetails ? (
            <ObjectDetails selectedObject={instanceDetails} timezone={timezone} />
          ) : (
            <></>
          )}
          <ObjectDetails
            selectedObject={originalMessage}
            interactionData={selectedInteractionData}
            timezone={timezone}
          />
        </>
      ) : (
        <Typography variant="body2" gutterBottom color="textDisabled">
          Click an object in the 3D view to select it.
        </Typography>
      )}
    </ToolGroupFixedSizePane>
  );
});

function InteractionsBaseComponent({
  addPanel,
  selectedObject,
  interactionsTabType,
  onShowTopicSettings,
  setInteractionsTabType,
  timezone,
  toolbarItems,
}: Props): React.JSX.Element {
  return (
    <ExpandingToolbar
      tooltip="Inspect objects"
      icon={<Cursor20Regular />}
      toolbarItems={toolbarItems}
      selectedTab={interactionsTabType}
      onSelectTab={(newSelectedTab) => {
        setInteractionsTabType(newSelectedTab);
      }}
    >
      <ToolGroup name={OBJECT_TAB_TYPE}>
        <SelectedObjectPane
          addPanel={addPanel}
          onShowTopicSettings={onShowTopicSettings}
          selectedObject={selectedObject}
          timezone={timezone}
        />
      </ToolGroup>
    </ExpandingToolbar>
  );
}

export default function Interactions(props: Props): React.JSX.Element {
  return <InteractionsBaseComponent {...props} />;
}
