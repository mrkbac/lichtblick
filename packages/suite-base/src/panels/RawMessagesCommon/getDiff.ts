// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.
import * as _ from "lodash-es";

import { isTypicalFilterName } from "@lichtblick/suite-base/components/MessagePathSyntax/isTypicalFilterName";
import { diffArrow } from "@lichtblick/suite-base/panels/RawMessagesCommon/constants";
import { diffLabels, DiffObject } from "@lichtblick/suite-base/panels/RawMessagesCommon/types";

function findIdField(before: unknown[], after: unknown[]): string | undefined {
  const allItems = before.concat(after);
  const first = allItems[0];
  if (
    typeof first !== "object" ||
    first == undefined ||
    !allItems.every((item) => typeof item === "object" && item != undefined)
  ) {
    return undefined;
  }

  const candidates = (first as DiffObject).id != undefined ? ["id"] : [];
  for (const key in first) {
    if (isTypicalFilterName(key) && !candidates.includes(key)) {
      candidates.push(key);
    }
  }

  const isUnique = (items: unknown[], key: string) =>
    new Set(items.map((item) => (item as DiffObject)[key]).filter((value) => value != undefined))
      .size === items.length;
  return candidates.find((key) => isUnique(before, key) && isUnique(after, key));
}

function diffArraysByIdField(
  before: unknown[],
  after: unknown[],
  idToCompareWith: string,
  { showFullMessageForDiff }: { showFullMessageForDiff: boolean },
): DiffObject[] {
  const unmatchedAfterById = _.keyBy(after, idToCompareWith);
  const diff: DiffObject[] = [];

  for (const beforeItem of before) {
    if (beforeItem == undefined || typeof beforeItem !== "object") {
      throw new Error("beforeItem is invalid; should have checked this earlier");
    }
    const id = (beforeItem as DiffObject)[idToCompareWith];
    const innerDiff = getDiff({
      before: beforeItem,
      after: unmatchedAfterById[String(id)],
      idLabel: idToCompareWith,
      showFullMessageForDiff,
    });
    delete unmatchedAfterById[String(id)];

    if (!_.isEmpty(innerDiff)) {
      const itemDiff = innerDiff as DiffObject;
      const keys = Object.keys(itemDiff);
      const isDeletion = keys.length === 1 && keys[0] === diffLabels.DELETED.labelText;
      diff.push(
        isDeletion
          ? itemDiff
          : { [diffLabels.ID.labelText]: { [idToCompareWith]: id }, ...itemDiff },
      );
    }
  }

  for (const afterItem of Object.values(unmatchedAfterById)) {
    const innerDiff = getDiff({
      before: undefined,
      after: afterItem,
      idLabel: idToCompareWith,
      showFullMessageForDiff,
    });
    if (!_.isEmpty(innerDiff)) {
      diff.push(innerDiff as DiffObject);
    }
  }

  return diff;
}

function diffArrays(
  before: unknown[],
  after: unknown[],
  { showFullMessageForDiff }: { showFullMessageForDiff: boolean },
): DiffObject | DiffObject[] | undefined {
  const idToCompareWith = findIdField(before, after);
  if (idToCompareWith != undefined) {
    return diffArraysByIdField(before, after, idToCompareWith, { showFullMessageForDiff });
  }
  // Fall back to treating array as object (diff by index)
  return diffObjects(before as unknown as DiffObject, after as unknown as DiffObject, {
    showFullMessageForDiff,
  });
}

function diffObjects(
  before: DiffObject,
  after: DiffObject,
  { showFullMessageForDiff }: { showFullMessageForDiff: boolean },
): DiffObject {
  const diff: DiffObject = {};
  const allKeys = Object.keys(before).concat(Object.keys(after));

  for (const key of new Set(allKeys)) {
    const innerDiff = getDiff({
      before: before[key],
      after: after[key],
      showFullMessageForDiff,
    });
    if (!_.isEmpty(innerDiff)) {
      diff[key] = innerDiff;
    } else if (showFullMessageForDiff) {
      diff[key] = before[key] ?? {};
    }
  }

  return diff;
}

function labeled(labelText: string, value: unknown, idLabel?: string): DiffObject {
  if (!idLabel || Array.isArray(value) || typeof value !== "object") {
    return { [labelText]: value };
  }
  const valueObj = value as DiffObject;
  return {
    [labelText]: { [diffLabels.ID.labelText]: { [idLabel]: valueObj[idLabel] }, ...valueObj },
  };
}

function createChangedDiff(before: unknown, after: unknown): DiffObject {
  const beforeText = typeof before === "bigint" ? before.toString() : JSON.stringify(before);
  const afterText = typeof after === "bigint" ? after.toString() : JSON.stringify(after);
  return {
    [diffLabels.CHANGED.labelText]: `${beforeText} ${diffArrow} ${afterText}`,
  };
}

export default function getDiff({
  before,
  after,
  idLabel,
  showFullMessageForDiff = false,
}: {
  before: unknown;
  after: unknown;
  idLabel?: string;
  showFullMessageForDiff?: boolean;
}): undefined | DiffObject | DiffObject[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    return diffArrays(before, after, { showFullMessageForDiff });
  }

  if (typeof before === "object" && typeof after === "object" && before && after) {
    return diffObjects(before as DiffObject, after as DiffObject, { showFullMessageForDiff });
  }

  if (before === after) {
    return undefined;
  }

  if (before == undefined) {
    return labeled(diffLabels.ADDED.labelText, after, idLabel);
  }

  if (after == undefined) {
    return labeled(diffLabels.DELETED.labelText, before, idLabel);
  }

  return createChangedDiff(before, after);
}
