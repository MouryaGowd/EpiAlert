export type IncidentStatus =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "RESOLVED"
  | "CANCELLED"
  | "FLAGGED"
  | "EXPIRED";

export type IncidentEvent = "ack" | "resolve" | "cancel" | "flagThreshold" | "expire";

const TABLE: Partial<Record<IncidentStatus, Partial<Record<IncidentEvent, IncidentStatus>>>> = {
  OPEN: {
    ack: "ACKNOWLEDGED",
    cancel: "CANCELLED",
    flagThreshold: "FLAGGED",
    expire: "EXPIRED",
  },
  ACKNOWLEDGED: {
    resolve: "RESOLVED",
    cancel: "CANCELLED",
    flagThreshold: "FLAGGED",
    expire: "EXPIRED",
  },
};

/** Pure transition. Terminal states have no entry, so every event is illegal there. */
export function transition(from: IncidentStatus, event: IncidentEvent): IncidentStatus {
  const to = TABLE[from]?.[event];
  if (!to) throw new Error(`illegal transition: ${from} --${event}-->`);
  return to;
}
