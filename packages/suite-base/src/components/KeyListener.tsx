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

import { ReactElement, useEffect, useLayoutEffect, useRef } from "react";

// Invoke handler for matching key.
// By default, preventDefault() is invoked on the event. Return false to allow the default.
type KeyHandlers = Record<string, (event: KeyboardEvent) => void | boolean | undefined>;

export type KeyListenerProps = {
  global?: boolean;
  keyDownHandlers?: KeyHandlers;
  keyUpHandlers?: KeyHandlers;
};

/** Events a KeyListener prevented, so other KeyListeners for the same key still run. */
const preventedByKeyListener = new WeakSet<Event>();

function callHandlers(handlers: KeyHandlers | undefined, event: KeyboardEvent): void {
  if (!handlers) {
    return;
  }

  const handler = handlers[event.key.toLowerCase()] ?? handlers[event.code];

  if (typeof handler === "function") {
    let preventDefault = true;
    try {
      preventDefault = handler(event) ?? true;
    } finally {
      if (preventDefault) {
        event.preventDefault();
        preventedByKeyListener.add(event);
      }
    }
  }
}

export default function KeyListener(props: KeyListenerProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);

  // Handlers live in a ref so the DOM listener stays attached when they change. Re-attaching it
  // mid-dispatch would drop the event: a listener removed during dispatch never runs, so an earlier
  // handler that synchronously re-renders this one (e.g. a parent panel exiting fullscreen) would
  // swallow the key.
  const handlers = useRef(props);
  useLayoutEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    const handleEvent = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) {
        return;
      }
      const { target, type } = event;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement &&
          (target.contentEditable === "true" || target.isContentEditable)) ||
        (target instanceof HTMLElement && target.closest(".monaco-editor"))
      ) {
        // The user is typing in an editable field; ignore the event.
        return;
      }
      if (event.defaultPrevented && !preventedByKeyListener.has(event)) {
        // The focused element already handled the key (e.g. arrow keys in a tree, slider or
        // menu), so it isn't also a shortcut.
        return;
      }

      const { keyDownHandlers, keyUpHandlers } = handlers.current;
      switch (type) {
        case "keydown":
          callHandlers(keyDownHandlers, event);
          break;
        case "keyup":
          callHandlers(keyUpHandlers, event);
          break;
        default:
          break;
      }
    };
    const target = props.global === true ? document : element.current?.parentElement;

    target?.addEventListener("keydown", handleEvent);
    target?.addEventListener("keyup", handleEvent);

    return () => {
      target?.removeEventListener("keydown", handleEvent);
      target?.removeEventListener("keyup", handleEvent);
    };
  }, [props.global]);

  return <div style={{ display: "none" }} ref={element} />;
}
