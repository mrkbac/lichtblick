// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Image20Filled, Image20Regular, ImageOff20Regular } from "@fluentui/react-icons";
import CheckIcon from "@mui/icons-material/Check";
import { Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem } from "@mui/material";
import { useState } from "react";

import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";

import { usePreviewTopic } from "./useScrubPreview";

/** Picks the image topic shown as a thumbnail when hovering the playback bar. */
export function ScrubPreviewMenu(): ReactNull | React.JSX.Element {
  const { imageTopics, topic, setSetting } = usePreviewTopic();
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);

  if (imageTopics.length === 0) {
    return ReactNull;
  }

  const choose = (value: string) => {
    void setSetting(value);
    setAnchorEl(undefined);
  };

  const item = ({ label, value, checked }: { label: string; value: string; checked: boolean }) => (
    <MenuItem
      key={value}
      selected={checked}
      onClick={() => {
        choose(value);
      }}
    >
      {checked && (
        <ListItemIcon>
          <CheckIcon fontSize="small" />
        </ListItemIcon>
      )}
      <ListItemText
        inset={!checked}
        primary={label}
        slotProps={{ primary: { variant: "inherit" } }}
      />
    </MenuItem>
  );

  return (
    <>
      <HoverableIconButton
        size="small"
        title={topic ? `Timeline preview: ${topic}` : "Timeline preview: off"}
        color={topic ? "primary" : "inherit"}
        icon={topic ? <Image20Regular /> : <ImageOff20Regular />}
        activeIcon={topic ? <Image20Filled /> : <ImageOff20Regular />}
        aria-haspopup="true"
        onClick={(event) => {
          setAnchorEl(event.currentTarget);
        }}
        data-testid="scrub-preview-button"
      />
      <Menu
        anchorEl={anchorEl}
        open={anchorEl != undefined}
        onClose={() => {
          setAnchorEl(undefined);
        }}
        slotProps={{ list: { dense: true } }}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <ListSubheader>Timeline preview</ListSubheader>
        {item({ label: "Off", value: "", checked: topic == undefined })}
        <Divider />
        {imageTopics.map((name) => item({ label: name, value: name, checked: name === topic }))}
      </Menu>
    </>
  );
}
