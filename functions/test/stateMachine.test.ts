import { describe, it, expect } from "vitest";
import { transition, type IncidentStatus, type IncidentEvent } from "../src/stateMachine.js";

const legal: [IncidentStatus, IncidentEvent, IncidentStatus][] = [
  ["OPEN", "ack", "ACKNOWLEDGED"],
  ["OPEN", "cancel", "CANCELLED"],
  ["OPEN", "flagThreshold", "FLAGGED"],
  ["OPEN", "expire", "EXPIRED"],
  ["ACKNOWLEDGED", "resolve", "RESOLVED"],
  ["ACKNOWLEDGED", "cancel", "CANCELLED"],
  ["ACKNOWLEDGED", "flagThreshold", "FLAGGED"],
  ["ACKNOWLEDGED", "expire", "EXPIRED"],
];

describe("incident state machine", () => {
  it.each(legal)("%s --%s--> %s", (from, ev, to) => {
    expect(transition(from, ev)).toBe(to);
  });

  const terminals: IncidentStatus[] = ["RESOLVED", "CANCELLED", "FLAGGED", "EXPIRED"];
  const events: IncidentEvent[] = ["ack", "resolve", "cancel", "flagThreshold", "expire"];

  it.each(terminals.flatMap((s) => events.map((e) => [s, e] as const)))(
    "terminal %s rejects %s",
    (s, e) => {
      expect(() => transition(s, e)).toThrow(/illegal transition/);
    },
  );

  it("OPEN cannot resolve directly", () => {
    expect(() => transition("OPEN", "resolve")).toThrow(/illegal transition/);
  });
  it("ACKNOWLEDGED cannot ack again", () => {
    expect(() => transition("ACKNOWLEDGED", "ack")).toThrow(/illegal transition/);
  });
});
