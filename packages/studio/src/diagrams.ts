/**
 * Architecture diagrams for the five build workflows: a data-flow view of the design Model A wrote, with the area
 * that will change marked. They are written by hand from the recorded design text (see diagrams.test.ts, which
 * checks every file name against that text), not made by a model. A diagram shows three views of one design:
 * Model A's draft, Model B's findings pinned to it, and the approved design.
 */

export type NodeKind = "entity" | "process" | "store";
/** new: a file that is created. modify: an existing file that changes. context: part of the system that stays as it is. */
export type Area = "new" | "modify" | "context";

export interface DiagramNode {
  id: string;
  kind: NodeKind;
  area: Area;
  /** Position on a grid of 4 columns (0-3) and 3 rows (0-2). */
  col: number;
  row: number;
  label: string;
  /** A short line under the label. */
  sub: string;
  /** The same line in the draft, when the review changed it. */
  draftSub?: string;
  /** The path as the design gives it. */
  file?: string;
  /** The node exists only after the review (it is not in the draft). */
  since?: "review";
  /** The review finding that points at this node. */
  finding?: string;
  /** The review finding that this node resolves. */
  fixedBy?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  /** Data moves both ways. */
  both?: boolean;
  since?: "review";
}

export interface ArchDiagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** One sentence for a person who cannot see the picture. */
  summary: string;
}

const healthcare: ArchDiagram = {
  summary:
    "A specialist clicks Mark Ready. The button builds a line from the denial record and calls the new appealReady rule. The API handler calls the same rule again, so no role can bypass the gate.",
  nodes: [
    { id: "specialist", kind: "entity", area: "context", col: 0, row: 1, label: "Specialist", sub: "marks an appeal ready" },
    { id: "record", kind: "store", area: "context", col: 0, row: 2, label: "Denial record", sub: "CARC, note ref, date of service" },
    { id: "button", kind: "process", area: "modify", col: 1, row: 1, label: "Mark Ready button", sub: "shows what is missing", file: "src/denials/MarkReadyButton.tsx" },
    { id: "deadline", kind: "process", area: "new", col: 2, row: 0, label: "filingDeadline(dos)", sub: "date of service + 90 days, UTC", file: "src/denials/filingDeadline.ts" },
    { id: "ready", kind: "process", area: "new", col: 2, row: 1, label: "appealReady(line)", sub: "ready, or what is missing", file: "src/denials/appealReady.ts" },
    { id: "handler", kind: "process", area: "modify", col: 2, row: 2, label: "Mark Ready API handler", sub: "rejects if not ready, any role", file: "src/api/denials/markReady.ts" },
  ],
  edges: [
    { from: "specialist", to: "button", label: "clicks Mark Ready" },
    { from: "record", to: "button", label: "carc, note ref, date" },
    { from: "button", to: "deadline", label: "date of service" },
    { from: "button", to: "ready", label: "line" },
    { from: "button", to: "handler", label: "request" },
    { from: "handler", to: "ready", label: "line (server check)" },
    { from: "handler", to: "record", label: "mark ready, if ready" },
  ],
};

const education: ArchDiagram = {
  summary:
    "A nightly job reads attendance and grades, applies the risk rule, updates the flag state and tells the counsellor when a flag is new. A visibility guard lets only the student's counsellor or the head of year see a flag.",
  nodes: [
    { id: "data", kind: "store", area: "context", col: 0, row: 0, label: "Attendance and grades", sub: "read-only source tables" },
    { id: "job", kind: "process", area: "new", col: 1, row: 0, label: "Nightly flag job", sub: "recomputes each school day" },
    { id: "rule", kind: "process", area: "new", col: 2, row: 0, label: "riskFlag(student)", sub: "under 90% or 2+ fails" },
    { id: "notifier", kind: "process", area: "new", col: 3, row: 0, label: "Counsellor notifier", sub: "alerts when a flag is new" },
    { id: "state", kind: "store", area: "modify", col: 1, row: 1, label: "Flag state", sub: "flagged, clearDays, date" },
    { id: "counsellor", kind: "entity", area: "context", col: 3, row: 1, label: "Counsellor", sub: "gets the alert" },
    { id: "viewer", kind: "entity", area: "context", col: 0, row: 2, label: "Head of year or counsellor", sub: "wants to see a flag" },
    { id: "guard", kind: "process", area: "new", col: 2, row: 2, label: "canSeeFlag(viewer, student)", sub: "own counsellor or head of year" },
  ],
  edges: [
    { from: "data", to: "job", label: "present, school days, fails" },
    { from: "job", to: "rule", label: "student data, wasFlagged" },
    { from: "job", to: "state", label: "flagged, clearDays" },
    { from: "rule", to: "notifier", label: "newly raised" },
    { from: "notifier", to: "counsellor", label: "alert" },
    { from: "viewer", to: "guard", label: "asks · allow or deny", both: true },
    { from: "state", to: "guard", label: "flag, counsellorId" },
  ],
};

const fmcg: ArchDiagram = {
  summary:
    "Distributor stock and sell-out go to the alerter, which uses daysOfCover and alerts at seven days or less. After the review, the portal hook writes to a durable sent-alerts record before it posts, so a restart cannot send a second alert on the same day.",
  nodes: [
    { id: "dist", kind: "entity", area: "context", col: 0, row: 1, label: "Distributor data", sub: "stock on hand, 28-day sell-out" },
    { id: "cover", kind: "process", area: "new", col: 1, row: 0, label: "daysOfCover()", sub: "stock / (sell-out / 28)", file: "stockout/daysOfCover.js" },
    {
      id: "alerter",
      kind: "process",
      area: "new",
      col: 1,
      row: 1,
      label: "createAlerter().check",
      sub: "alerts at 7 days or less",
      file: "stockout/alerter.js",
      finding: "AR-1",
    },
    {
      id: "hook",
      kind: "process",
      area: "new",
      col: 2,
      row: 1,
      label: "Portal notification hook",
      sub: "posts only if the insert works",
      draftSub: "posts the alert to the ASM",
      fixedBy: "AR-1",
    },
    { id: "sent", kind: "store", area: "new", col: 2, row: 2, label: "Sent-alerts record", sub: "key: distributor|sku|date", since: "review", fixedBy: "AR-1" },
    { id: "asm", kind: "entity", area: "context", col: 3, row: 1, label: "Area sales manager", sub: "gets the alert in the portal" },
  ],
  edges: [
    { from: "dist", to: "alerter", label: "stock, sell-out, date" },
    { from: "alerter", to: "cover", label: "stock, sell-out · cover", both: true },
    { from: "alerter", to: "hook", label: "alert: cover 7 days or less" },
    { from: "hook", to: "sent", label: "insert if absent", since: "review" },
    { from: "hook", to: "asm", label: "alert" },
  ],
};

const logistics: ArchDiagram = {
  summary:
    "Delivery tracking sends each ETA update to the notifier. The notifier uses time.js to find how late the delivery is, sends at most two notices, and the caller formats each one with the date and the zone name.",
  nodes: [
    { id: "track", kind: "entity", area: "context", col: 0, row: 1, label: "Delivery tracking", sub: "ETA updates, promised time" },
    { id: "time", kind: "process", area: "new", col: 1, row: 0, label: "time.js", sub: "toUtc, minutesLate (by zone)", file: "src/delay/time.js" },
    { id: "notifier", kind: "process", area: "new", col: 1, row: 1, label: "createNotifier", sub: "two notices at most", file: "src/delay/notifier.js" },
    { id: "format", kind: "process", area: "new", col: 2, row: 1, label: "formatForCustomer", sub: "2 Mar, 02:30 (India time)", file: "src/delay/format.js" },
    { id: "customer", kind: "entity", area: "context", col: 3, row: 1, label: "Customer", sub: "gets the delay notice" },
  ],
  edges: [
    { from: "track", to: "notifier", label: "id, ETA, promised time" },
    { from: "notifier", to: "time", label: "promised, ETA · minutes late", both: true },
    { from: "notifier", to: "format", label: "notice, ETA, zone" },
    { from: "format", to: "customer", label: "date, time, zone name" },
  ],
};

const finance: ArchDiagram = {
  summary:
    "An applicant enters four numbers on a new pre-qualification screen. The screen calls the pure prequalify function and shows the result. After the review, the screen builds the full success reason itself. The rest of the lending app does not change.",
  nodes: [
    { id: "applicant", kind: "entity", area: "context", col: 0, row: 1, label: "Applicant", sub: "enters four numbers" },
    { id: "route", kind: "process", area: "modify", col: 1, row: 0, label: "App navigation", sub: "adds one route entry" },
    {
      id: "screen",
      kind: "process",
      area: "new",
      col: 1,
      row: 1,
      label: "Pre-qualification screen",
      sub: "result, reasons, success text",
      draftSub: "result, reasons; reason open",
      file: "src/screens/PreQualification.(tsx|jsx)",
      finding: "AR-1",
      fixedBy: "AR-1",
    },
    { id: "prequal", kind: "process", area: "new", col: 2, row: 1, label: "prequalify(input)", sub: "pure: DTI ≤ 43%, score ≥ 640", file: "src/prequal/prequalify.(ts|js)" },
    { id: "rest", kind: "process", area: "context", col: 3, row: 1, label: "Rest of the lending app", sub: "credit decision, storage" },
  ],
  edges: [
    { from: "applicant", to: "screen", label: "four numbers · result", both: true },
    { from: "route", to: "screen", label: "opens the screen" },
    { from: "screen", to: "prequal", label: "four numbers · result", both: true },
  ],
};

export const ARCH_DIAGRAMS: Record<string, ArchDiagram> = {
  "healthcare-build": healthcare,
  "education-build": education,
  "fmcg-build": fmcg,
  "logistics-build": logistics,
  "finance-build": finance,
};
