// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  NavSatFixMsg,
  NavSatFixPositionCovarianceType,
} from "@lichtblick/suite-base/panels/Map/types";

/**
 * Calculates the accuracy of a NavSatFix message, based on its type, and returns
 * information suitable for display as a leaflet Ellipse.
 *
 * @param msg NavSatFix
 * @returns radii and tilt (degrees from W)
 */
export function getAccuracy(
  msg: NavSatFixMsg,
): { radii: [number, number]; tilt: number } | undefined {
  const covariance = msg.position_covariance;
  if (!covariance) {
    return undefined;
  }

  switch (msg.position_covariance_type) {
    case undefined:
      return undefined;
    case NavSatFixPositionCovarianceType.COVARIANCE_TYPE_UNKNOWN:
      return undefined;
    case NavSatFixPositionCovarianceType.COVARIANCE_TYPE_DIAGONAL_KNOWN: {
      // Tilt is degrees from west
      const eastVariance = covariance[0];
      const northVariance = covariance[4];
      if (!isFinite(eastVariance) || !isFinite(northVariance)) {
        return undefined;
      }
      return { radii: [Math.sqrt(eastVariance), Math.sqrt(northVariance)], tilt: 0 };
    }
    case NavSatFixPositionCovarianceType.COVARIANCE_TYPE_APPROXIMATED:
    case NavSatFixPositionCovarianceType.COVARIANCE_TYPE_KNOWN: {
      // Discard altitude. The east/north block [[a, c], [c, d]] is symmetric, so its eigenvalues
      // and the major-axis direction have a closed form.
      const a = covariance[0];
      const d = covariance[4];
      const c = covariance[1];
      // A covariance matrix is symmetric; anything else is corrupt data.
      if (Math.abs(c - covariance[3]) > 1e-9 * Math.max(Math.abs(c), Math.abs(covariance[3]), 1)) {
        return undefined;
      }
      const mean = (a + d) / 2;
      const spread = Math.hypot((a - d) / 2, c);
      const primaryRadius = Math.sqrt(mean + spread);
      const secondaryRadius = Math.sqrt(mean - spread);

      // Ellipse `tilt` is defined as number of degrees from the negative x axis
      const tilt = (-0.5 * Math.atan2(2 * c, a - d) * 180) / Math.PI;

      if (!isFinite(tilt) || !isFinite(primaryRadius) || !isFinite(secondaryRadius)) {
        return undefined;
      }
      return { radii: [primaryRadius, secondaryRadius], tilt };
    }
  }
}
