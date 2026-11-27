// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useRef, useState } from "react";

import { DeltaMarker } from "@lichtblick/suite-base/panels/shared/types";

export type UseDeltaMarkerStateProps = {
  resetKey?: string;
};

export type UseDeltaMarkerStateResult = {
  active: boolean;
  toggleActive: () => void;
  markerA: DeltaMarker | undefined;
  markerB: DeltaMarker | undefined;
  removeMarkerA: () => void;
  removeMarkerB: () => void;
  nextMarkerSlot: () => DeltaMarkerSlotReservation;
  setMarker: (reservation: DeltaMarkerSlotReservation, marker: DeltaMarker) => void;
};

export type DeltaMarkerSlotReservation = {
  slot: "a" | "b";
  /** Unique per reservation; resets clear the pending reservations, so stale tokens never match */
  token: number;
};

function useDeltaMarkerState({ resetKey }: UseDeltaMarkerStateProps): UseDeltaMarkerStateResult {
  const [active, setActive] = useState(false);
  const [markerA, setMarkerA] = useState<DeltaMarker | undefined>(undefined);
  const [markerB, setMarkerB] = useState<DeltaMarker | undefined>(undefined);
  const nextReservationTokenRef = useRef(0);
  const pendingReservationsRef = useRef(
    new Map<DeltaMarkerSlotReservation["slot"], DeltaMarkerSlotReservation>(),
  );

  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    pendingReservationsRef.current.clear();
    setMarkerA(undefined);
    setMarkerB(undefined);
  }

  const toggleActive = useCallback(() => {
    pendingReservationsRef.current.clear();
    setActive((prevActive) => !prevActive);
    setMarkerA(undefined);
    setMarkerB(undefined);
  }, []);

  const removeMarkerA = useCallback(() => {
    pendingReservationsRef.current.delete("a");
    setMarkerA(undefined);
  }, []);

  const removeMarkerB = useCallback(() => {
    pendingReservationsRef.current.delete("b");
    setMarkerB(undefined);
  }, []);

  const nextMarkerSlot = useCallback((): DeltaMarkerSlotReservation => {
    const pendingReservations = pendingReservationsRef.current;
    const aReserved = markerA != undefined || pendingReservations.has("a");
    const bReserved = markerB != undefined || pendingReservations.has("b");
    const slot: "a" | "b" = !aReserved || bReserved ? "a" : "b";
    if (slot === "a") {
      pendingReservations.delete("b");
      setMarkerB(undefined);
    }
    const reservation = {
      slot,
      token: nextReservationTokenRef.current++,
    };
    pendingReservations.set(slot, reservation);
    return reservation;
  }, [markerA, markerB]);

  const setMarker = useCallback((reservation: DeltaMarkerSlotReservation, marker: DeltaMarker) => {
    if (pendingReservationsRef.current.get(reservation.slot)?.token !== reservation.token) {
      return;
    }

    pendingReservationsRef.current.delete(reservation.slot);
    if (reservation.slot === "a") {
      setMarkerA(marker);
    } else {
      setMarkerB(marker);
    }
  }, []);

  return {
    active,
    toggleActive,
    markerA,
    markerB,
    removeMarkerA,
    removeMarkerB,
    nextMarkerSlot,
    setMarker,
  };
}

export default useDeltaMarkerState;
