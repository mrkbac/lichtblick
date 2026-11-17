// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Menu, MenuItem, MenuProps } from "@mui/material";

import type { PickedRenderable } from "../Picker";

type ClickedPosition = { clientX: number; clientY: number };

type Props = {
  clickedPosition: ClickedPosition;
  clickedObjects: readonly PickedRenderable[];
  onClose: MenuProps["onClose"];
  selectObject: (picked: PickedRenderable) => void;
};

export function InteractionContextMenu({
  clickedObjects,
  clickedPosition,
  onClose,
  selectObject,
}: Props): React.JSX.Element {
  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{
        top: clickedPosition.clientY,
        left: clickedPosition.clientX,
      }}
      slotProps={{
        list: {
          dense: true,
        },
      }}
    >
      {clickedObjects.map((picked, index) => (
        <MenuItem
          key={index}
          data-test="InteractionContextMenuItem"
          onClick={() => {
            selectObject(picked);
          }}
        >
          {picked.renderable.name}
        </MenuItem>
      ))}
    </Menu>
  );
}
