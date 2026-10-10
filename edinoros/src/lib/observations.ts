import type { Observation, ObservationStatus } from "@/src/types/domain";

export const OBSERVATION_STATUS_LABEL: Record<ObservationStatus, string> = {
  draft: "черновик",
  confirmed: "проверена",
  refuted: "опровергнута",
  stale: "устарела",
};

export const OBSERVATION_STATUSES: ObservationStatus[] = [
  "draft",
  "confirmed",
  "refuted",
  "stale",
];

/**
 * Статус наблюдения. В моках поля status нет — там лежит устаревшее hypothesis,
 * поэтому для старых записей статус выводится из него.
 */
export function resolveObservationStatus(
  observation: Observation,
): ObservationStatus {
  if (observation.status) return observation.status;

  switch (observation.hypothesis) {
    case "confirmed":
      return "confirmed";
    case "refuted":
      return "refuted";
    default:
      return "draft";
  }
}

export const FIELD_TYPES = ["u8", "u16", "u32", "bytes", "string"] as const;
