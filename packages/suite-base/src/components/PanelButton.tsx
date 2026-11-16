// SPDX-License-Identifier: MPL-2.0

import { IconButton, IconButtonProps, Typography } from "@mui/material";
import { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import OverlayToolbar from "@lichtblick/suite-base/components/OverlayToolbar";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import type { panelButtons } from "@lichtblick/suite-base/i18n/en/panelButtons";
import { firstBindingLabel, KeyboardShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

/**
 * A panel button, declared once (usually in the panel's `buttons.ts`). The panel draws it with
 * {@link PanelIconButton} and the panel guide lists it, so the two can't drift apart.
 */
export type PanelButton = {
  /** Key in the panelButtons i18n namespace, which holds the title and the help text. */
  id: keyof typeof panelButtons;
  icon: ComponentType;
  /** Where the panel draws it: its toolbar, a floating overlay toolbar, or inline in content. */
  placement: "toolbar" | "overlay" | "inline";
  /** The shortcut that does the same; its key is appended to the title, e.g. "Box zoom (Z)". */
  shortcut?: KeyboardShortcut;
};

type PanelIconButtonProps = Omit<IconButtonProps, "title" | "children"> & {
  button: PanelButton;
  /** Replaces the declared icon, e.g. a filled variant while active. */
  children?: ReactNode;
};

/**
 * The declared title, with the linked shortcut's key, for a panel that draws a button its own way
 * (e.g. a Fab or a row button).
 */
export function usePanelButtonTitle(button: PanelButton): string {
  const { t } = useTranslation("panelButtons");
  const title = t(`${button.id}.title`);
  const binding = button.shortcut != undefined ? firstBindingLabel(button.shortcut) : undefined;
  return binding != undefined ? `${title} (${binding})` : title;
}

/** Draws a declared panel button in the style of its placement, titled from its declaration. */
export function PanelIconButton(props: PanelIconButtonProps): React.JSX.Element {
  const { button, children, ...rest } = props;
  const Icon = button.icon;
  const title = usePanelButtonTitle(button);
  const content = children ?? <Icon />;
  // A disabled button gets no pointer events, so its wrapper carries the tooltip.
  const tooltip = rest.disabled === true ? undefined : title;
  const toolbar = button.placement === "toolbar";
  const Button = toolbar ? ToolbarIconButton : IconButton;
  const element = (
    <Button size={toolbar ? undefined : "small"} title={tooltip} aria-label={title} {...rest}>
      {content}
    </Button>
  );
  return rest.disabled === true ? (
    <span title={title} style={{ display: "inline-flex" }}>
      {element}
    </span>
  ) : (
    element
  );
}

/** An inert picture of the button as the panel draws it, for the panel guide. */
export function PanelButtonPreview(props: { button: PanelButton }): React.JSX.Element {
  const inert = {
    component: "span",
    tabIndex: -1,
    disableRipple: true,
    style: { pointerEvents: "none" },
  } as const;
  const preview = <PanelIconButton button={props.button} {...inert} />;
  return (
    <span aria-hidden>
      {props.button.placement === "overlay" ? (
        <OverlayToolbar style={{ width: "fit-content", pointerEvents: "none" }}>
          {preview}
        </OverlayToolbar>
      ) : (
        preview
      )}
    </span>
  );
}

/** The ".*" label of a regular-expression toggle, for use as a declared button's icon. */
export function RegexLabel(): React.JSX.Element {
  return (
    <Typography variant="caption" style={{ fontFamily: "monospace", lineHeight: 1 }}>
      .*
    </Typography>
  );
}
