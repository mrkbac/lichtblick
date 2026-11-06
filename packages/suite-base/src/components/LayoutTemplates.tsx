// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ListItemText, Menu, MenuItem } from "@mui/material";
import { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import {
  Command,
  useRegisterCommands,
} from "@lichtblick/suite-base/components/CommandPalette/commands";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useLayoutManager } from "@lichtblick/suite-base/context/LayoutManagerContext";
import useCallbackWithToast from "@lichtblick/suite-base/hooks/useCallbackWithToast";
import {
  LAYOUT_TEMPLATES,
  LayoutTemplate,
  LayoutTemplateResult,
} from "@lichtblick/suite-base/util/layoutTemplates";

const MAX_LISTED_TOPICS = 3;

/** One line saying which topics a template would use. */
function topicSummary({ topics }: LayoutTemplateResult, t: TFunction<"layoutTemplates">): string {
  if (topics.length === 0) {
    return t("noMatchingTopics");
  }
  const listed = topics.slice(0, MAX_LISTED_TOPICS).join(", ");
  return t("topics", {
    count: topics.length,
    topics: topics.length > MAX_LISTED_TOPICS ? `${listed}, …` : listed,
  });
}

/** Builds every template for the current data source and creates + selects a layout from one. */
function useLayoutTemplates(): {
  previews: { template: LayoutTemplate; result: LayoutTemplateResult }[];
  create: (preview: { template: LayoutTemplate; result: LayoutTemplateResult }) => Promise<void>;
} {
  const { t } = useTranslation("layoutTemplates");
  const { topics, datatypes } = useDataSourceInfo();
  const layoutManager = useLayoutManager();
  const { setSelectedLayoutId } = useCurrentLayoutActions();

  const previews = useMemo(
    () =>
      LAYOUT_TEMPLATES.map((template) => ({ template, result: template.build(topics, datatypes) })),
    [topics, datatypes],
  );

  const create = useCallbackWithToast(
    async ({ template, result }: { template: LayoutTemplate; result: LayoutTemplateResult }) => {
      const layout = await layoutManager.saveNewLayout({
        name: t(template.id),
        data: result.data,
        permission: "CREATOR_WRITE",
      });
      setSelectedLayoutId(layout.id);
    },
    [layoutManager, setSelectedLayoutId, t],
  );

  return { previews, create };
}

/** Adds "New layout from template: …" commands to the command palette. */
export function LayoutTemplateCommands(): undefined {
  const { t } = useTranslation("layoutTemplates");
  const { t: tPalette } = useTranslation("commandPalette");
  const { previews, create } = useLayoutTemplates();
  const commands = useMemo(
    () =>
      previews.map(
        (preview): Command => ({
          id: `layout.template.${preview.template.id}`,
          title: t("fromTemplateCommand", { name: t(preview.template.id) }),
          group: tPalette("groupLayout"),
          detail: topicSummary(preview.result, t),
          keywords: ["create", "starter"],
          run: async () => {
            await create(preview);
          },
        }),
      ),
    [create, previews, t, tPalette],
  );
  useRegisterCommands("layoutTemplates", commands);
  return undefined;
}

/** Menu of layout templates, each with the topics it would use. */
export function LayoutTemplateMenu({
  anchorEl,
  onClose,
}: {
  anchorEl: HTMLElement;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("layoutTemplates");
  const { previews, create } = useLayoutTemplates();
  return (
    <Menu open anchorEl={anchorEl} onClose={onClose}>
      {previews.map((preview) => (
        <MenuItem
          key={preview.template.id}
          onClick={() => {
            onClose();
            void create(preview);
          }}
        >
          <ListItemText
            primary={t(preview.template.id)}
            secondary={topicSummary(preview.result, t)}
          />
        </MenuItem>
      ))}
    </Menu>
  );
}
