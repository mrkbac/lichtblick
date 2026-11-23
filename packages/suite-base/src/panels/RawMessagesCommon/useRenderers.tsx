// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ReactNode, useCallback, useMemo, useState } from "react";

import { MessagePathStructureItem } from "@lichtblick/message-path";
import { MessagePathDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";

import ObjectSummary from "./ObjectSummary";
import Value from "./Value";
import { getStructureItemForPath, getValueActionForValue } from "./getValueActionForValue";
import { UseValueRendererProps, ValueAction, ValueRendererFunction } from "./types";
import { getConstantNameByKeyPath, getValueLabels } from "./utils";

function HoverArea({
  className,
  children,
}: {
  className?: string;
  children: (state: { isHovering: boolean }) => ReactNode;
}): React.JSX.Element {
  const [isHovering, setIsHovering] = useState(false);
  return (
    <div
      className={className}
      onPointerEnter={() => {
        setIsHovering(true);
      }}
      onPointerLeave={() => {
        setIsHovering(false);
      }}
    >
      {children({ isHovering })}
    </div>
  );
}

/**
 * Hook that provides a value renderer function for rendering message values in the tree.
 * This handles the logic for displaying values with hover actions, constant names, and proper formatting.
 */
export function useValueRenderer({
  datatypes,
  hoverObserverClassName,
  onTopicPathChange,
  openSiblingPanel,
}: UseValueRendererProps): ValueRendererFunction {
  const enumMapping = useMemo(() => enumValuesByDatatypeAndField(datatypes), [datatypes]);

  const valueRenderer = useCallback(
    (
      structureItem: MessagePathStructureItem | undefined,
      data: unknown[],
      queriedData: MessagePathDataItem[],
      label: string,
      itemValue: unknown,
      ...keyPath: (number | string)[]
    ) => (
      <HoverArea className={hoverObserverClassName}>
        {({ isHovering }) => {
          const lastKeyPath = keyPath.at(-1) as number;
          let valueAction: ValueAction | undefined;
          if (isHovering) {
            valueAction = getValueActionForValue(
              data[lastKeyPath],
              structureItem,
              keyPath.slice(0, -1).reverse(),
            );
          }

          let constantName: string | undefined = getConstantNameByKeyPath(keyPath, queriedData);
          if (structureItem) {
            const childStructureItem = getStructureItemForPath(
              structureItem,
              keyPath.slice(0, -1).reverse(),
            );
            if (childStructureItem) {
              const keyPathIndex = keyPath.findIndex((key) => typeof key === "string");
              const field = keyPath[keyPathIndex];
              if (typeof field === "string") {
                const datatype = childStructureItem.datatype;
                constantName = enumMapping[datatype]?.[field]?.[String(itemValue)];
              }
            }
          }
          const basePath = queriedData[lastKeyPath]?.path ?? "";
          const { arrLabel, itemLabel } = getValueLabels({
            constantName,
            label,
            itemValue,
            keyPath,
          });

          if (typeof itemValue === "object" && itemValue != undefined) {
            return <ObjectSummary value={itemValue} />;
          }

          return (
            <Value
              arrLabel={arrLabel}
              basePath={basePath}
              itemLabel={itemLabel}
              itemValue={itemValue}
              valueAction={valueAction}
              onTopicPathChange={onTopicPathChange}
              openSiblingPanel={openSiblingPanel}
            />
          );
        }}
      </HoverArea>
    ),
    [hoverObserverClassName, enumMapping, onTopicPathChange, openSiblingPanel],
  );

  return valueRenderer;
}
