// SPDX-License-Identifier: MPL-2.0

import { parse } from "yaml";

/** One publisher's offered ROS 2 QoS profile, as display strings. */
export type QosProfile = {
  reliability: string;
  durability: string;
  history: string;
  deadline: string;
  lifespan: string;
  liveliness: string;
  lease: string;
};

export const QOS_LABELS: Readonly<Record<keyof QosProfile, string>> = {
  reliability: "Reliability",
  durability: "Durability",
  history: "History",
  deadline: "Deadline",
  lifespan: "Lifespan",
  liveliness: "Liveliness",
  lease: "Liveliness lease",
};

/** Policies that decide whether a subscription matches a publisher. */
const MATCHING_POLICIES: readonly (keyof QosProfile)[] = [
  "reliability",
  "durability",
  "deadline",
  "liveliness",
  "lease",
];

// rmw enum values, used by rosbag2 before it switched to policy names.
const HISTORY = ["system default", "keep last", "keep all", "unknown"];
const RELIABILITY = ["system default", "reliable", "best effort", "unknown", "best available"];
const DURABILITY = ["system default", "transient local", "volatile", "unknown", "best available"];
const LIVELINESS = [
  "system default",
  "automatic",
  "manual by node",
  "manual by topic",
  "unknown",
  "best available",
];

function policy(value: unknown, names: readonly string[]): string {
  if (typeof value === "number") {
    return names[value] ?? `unknown (${value})`;
  }
  return typeof value === "string" ? value.toLowerCase().replaceAll("_", " ") : "—";
}

function duration(value: unknown): string {
  if (typeof value !== "object" || value == undefined) {
    return "—";
  }
  const { sec, nsec } = value as { sec?: unknown; nsec?: unknown };
  if (typeof sec !== "number" || typeof nsec !== "number") {
    return "—";
  }
  // 0 means "use the default", which is infinite for every duration policy; the
  // two sentinel encodings rmw uses for infinity are both ≥ INT32_MAX seconds.
  if ((sec === 0 && nsec === 0) || sec >= 2 ** 31 - 1) {
    return "∞";
  }
  return `${Number((sec + nsec / 1e9).toFixed(9))} s`;
}

/** Parses the `offered_qos_profiles` YAML that rosbag2 stores per topic. */
export function parseQosProfiles(yaml: string | undefined): QosProfile[] {
  if (yaml == undefined || yaml.trim() === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parse(yaml);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry != undefined,
    )
    .map((entry) => {
      const history = policy(entry.history, HISTORY);
      return {
        reliability: policy(entry.reliability, RELIABILITY),
        durability: policy(entry.durability, DURABILITY),
        history:
          history === "keep last" && typeof entry.depth === "number"
            ? `keep last ${entry.depth}`
            : history,
        deadline: duration(entry.deadline),
        lifespan: duration(entry.lifespan),
        liveliness: policy(entry.liveliness, LIVELINESS),
        lease: duration(entry.liveliness_lease_duration),
      };
    });
}

/** Policies whose value differs between publishers. */
export function differingPolicies(profiles: readonly QosProfile[]): (keyof QosProfile)[] {
  const keys = Object.keys(QOS_LABELS) as (keyof QosProfile)[];
  return keys.filter((key) => new Set(profiles.map((profile) => profile[key])).size > 1);
}

/** Differing policies that make one subscription unable to match every publisher. */
export function conflictingPolicies(profiles: readonly QosProfile[]): (keyof QosProfile)[] {
  return differingPolicies(profiles).filter((key) => MATCHING_POLICIES.includes(key));
}
