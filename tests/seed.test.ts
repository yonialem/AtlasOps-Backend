import { describe, it, expect, beforeAll } from "vitest";
import {
  DEFAULT_SEED,
  SEED_INCIDENT_COUNT,
  MOCK_SERVICES,
  MOCK_USERS,
  createMulberry32,
  generateSeedIncidents,
  resetSeed,
} from "../src/db/seed.ts";
import {
  IncidentSchema,
  IncidentNoteSchema,
  UserSummarySchema,
  Incident,
  IncidentNote,
  IncidentStatus,
  IncidentSeverity,
} from "../src/contracts/incident.types.ts";

/**
 * ============================================================================
 * TASK-BE-002: Deterministic Seed Generator (Mulberry32) - Test Suite
 * ============================================================================
 * Author: BE Test Writer Agent
 * File: backend/tests/seed.test.ts
 *
 * Verifies bit-for-bit deterministic pseudo-random generation of 1,048 incidents
 * conforming strictly to:
 * - specs/tasks/TASK-BE-002.md
 * - specs/api_spec.md (Section 5)
 * - contracts/incident.types.ts
 */

describe("TASK-BE-002: Seed Constants & Mock Fixtures Directory", () => {
  it("TEST-SEED-CONST-001: exports DEFAULT_SEED matching 0x41544c41 ('ATLA')", () => {
    expect(DEFAULT_SEED).toBe(0x41544c41);
    expect(DEFAULT_SEED).toBe(1096043585);
  });

  it("TEST-SEED-CONST-002: exports SEED_INCIDENT_COUNT matching exactly 1,048", () => {
    expect(SEED_INCIDENT_COUNT).toBe(1048);
  });

  it("TEST-SEED-CONST-003: exports MOCK_SERVICES with exactly the 7 defined monitored services", () => {
    const expectedServices = [
      "payments-api",
      "checkout-web",
      "identity-service",
      "notification-worker",
      "reporting-api",
      "auth-gateway",
      "inventory-service",
    ];

    expect(MOCK_SERVICES).toHaveLength(7);
    expect([...MOCK_SERVICES].sort()).toEqual([...expectedServices].sort());
    // Ensure no duplicates
    const uniqueServices = new Set(MOCK_SERVICES);
    expect(uniqueServices.size).toBe(7);
  });

  it("TEST-SEED-CONST-004: exports MOCK_USERS with exactly 10 valid operator profiles", () => {
    expect(MOCK_USERS).toHaveLength(10);

    const userIds = MOCK_USERS.map((u) => u.id);
    const expectedIds = Array.from({ length: 10 }, (_, i) => `usr-${i + 1}`);
    expect(userIds.sort()).toEqual(expectedIds.sort());

    for (const user of MOCK_USERS) {
      expect(() => UserSummarySchema.parse(user)).not.toThrow();
      expect(() => UserSummarySchema.strict().parse(user)).not.toThrow();
      expect(user.name.trim().length).toBeGreaterThan(0);
      expect(user.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    }
  });
});

describe("TASK-BE-002: Mulberry32 PRNG Algorithm (createMulberry32)", () => {
  it("TEST-SEED-PRNG-001: generates numbers strictly within [0, 1)", () => {
    const rng = createMulberry32(DEFAULT_SEED);
    for (let i = 0; i < 1000; i++) {
      const val = rng();
      expect(typeof val).toBe("number");
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
      expect(Number.isFinite(val)).toBe(true);
    }
  });

  it("TEST-SEED-PRNG-002: produces bit-for-bit identical sequences from identical seeds", () => {
    const rng1 = createMulberry32(0x41544c41);
    const rng2 = createMulberry32(0x41544c41);

    const seq1 = Array.from({ length: 500 }, () => rng1());
    const seq2 = Array.from({ length: 500 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("TEST-SEED-PRNG-003: defaults to DEFAULT_SEED when no seed argument is provided", () => {
    const rngDefault = createMulberry32();
    const rngExplicit = createMulberry32(DEFAULT_SEED);

    const seqDefault = Array.from({ length: 200 }, () => rngDefault());
    const seqExplicit = Array.from({ length: 200 }, () => rngExplicit());

    expect(seqDefault).toEqual(seqExplicit);
  });

  it("TEST-SEED-PRNG-004: produces distinct sequences for different seeds", () => {
    const rngA = createMulberry32(DEFAULT_SEED);
    const rngB = createMulberry32(123456789);

    const seqA = Array.from({ length: 50 }, () => rngA());
    const seqB = Array.from({ length: 50 }, () => rngB());

    expect(seqA).not.toEqual(seqB);
  });
});

describe("TASK-BE-002: Dataset Scale, Sequential Identification & Versioning", () => {
  it("TEST-SEED-002: synthesizes exactly 1,048 incidents with sequential IDs from INC-1001 to INC-2048", () => {
    const incidents = generateSeedIncidents();

    expect(incidents).toHaveLength(1048);
    expect(incidents[0].id).toBe("INC-1001");
    expect(incidents[1047].id).toBe("INC-2048");

    // Strictly sequential verification
    for (let i = 0; i < incidents.length; i++) {
      const expectedId = `INC-${1001 + i}`;
      expect(incidents[i].id).toBe(expectedId);
    }

    // ID uniqueness verification
    const idSet = new Set(incidents.map((inc) => inc.id));
    expect(idSet.size).toBe(1048);
  });

  it("TEST-SEED-SCALE-002: assigns initial version 1 to every generated incident", () => {
    const incidents = generateSeedIncidents();
    for (const incident of incidents) {
      expect(incident.version).toBe(1);
    }
  });
});

describe("TASK-BE-002: Deterministic Reproducibility & Seed Controls", () => {
  it("TEST-SEED-001: two independent calls to generateSeedIncidents() return bit-for-bit identical datasets", () => {
    const run1 = generateSeedIncidents(DEFAULT_SEED);
    const run2 = generateSeedIncidents(DEFAULT_SEED);

    expect(run1).toEqual(run2);
  });

  it("TEST-SEED-DET-002: generateSeedIncidents() defaults to DEFAULT_SEED", () => {
    const runDefault = generateSeedIncidents();
    const runExplicit = generateSeedIncidents(DEFAULT_SEED);

    expect(runDefault).toEqual(runExplicit);
  });

  it("TEST-SEED-DET-003: resetSeed() returns bit-for-bit identical dataset", () => {
    const seeded = generateSeedIncidents(DEFAULT_SEED);
    const reset = resetSeed();

    expect(reset).toEqual(seeded);
  });

  it("TEST-SEED-DET-004: returned dataset is fresh and mutations do not corrupt subsequent calls", () => {
    const firstCall = generateSeedIncidents();
    const originalTitle = firstCall[0].title;
    const originalStatus = firstCall[0].status;

    firstCall[0].title = "Corrupted Title That Should Not Persist";
    firstCall[0].status = originalStatus === "resolved" ? "triggered" : "resolved";

    const secondCall = generateSeedIncidents();
    expect(secondCall[0].title).toBe(originalTitle);
    expect(secondCall[0].status).toBe(originalStatus);
  });

  it("TEST-SEED-010: custom seed generates a deterministic and valid dataset distinct from DEFAULT_SEED", () => {
    const customRun1 = generateSeedIncidents(98765);
    const customRun2 = generateSeedIncidents(98765);
    const defaultRun = generateSeedIncidents(DEFAULT_SEED);

    expect(customRun1).toEqual(customRun2);
    expect(customRun1).toHaveLength(1048);
    expect(customRun1).not.toEqual(defaultRun);

    // Verify first 20 incidents have distinct fields compared to default
    const hasDifference = customRun1.slice(0, 20).some((inc, idx) => {
      return (
        inc.title !== defaultRun[idx].title ||
        inc.severity !== defaultRun[idx].severity ||
        inc.service !== defaultRun[idx].service ||
        inc.status !== defaultRun[idx].status
      );
    });
    expect(hasDifference).toBe(true);

    // Verify custom seed dataset also passes schema validation
    for (const incident of customRun1.slice(0, 50)) {
      expect(() => IncidentSchema.parse(incident)).not.toThrow();
    }
  });
});

describe("TASK-BE-002: Strict Schema Conformance & Zero Extra Fields", () => {
  let incidents: Incident[];

  beforeAll(() => {
    incidents = generateSeedIncidents();
  });

  it("TEST-SEED-003: every incident satisfies IncidentSchema validation", () => {
    for (const incident of incidents) {
      expect(() => IncidentSchema.parse(incident)).not.toThrow();
    }
  });

  it("TEST-SEED-SCHEMA-002: every incident strictly satisfies IncidentSchema with zero unapproved fields", () => {
    const allowedKeys = [
      "assignee",
      "createdAt",
      "description",
      "id",
      "notes",
      "service",
      "severity",
      "status",
      "title",
      "updatedAt",
      "version",
    ].sort();

    for (const incident of incidents) {
      // 1. Zod strict mode assertion
      expect(() => IncidentSchema.strict().parse(incident)).not.toThrow();

      // 2. Explicit key enumeration check
      const actualKeys = Object.keys(incident).sort();
      expect(actualKeys).toEqual(allowedKeys);

      // 3. Explicit check against forbidden fields
      const forbiddenFields = [
        "resolvedAt",
        "closedAt",
        "deletedAt",
        "priority",
        "tags",
        "category",
        "metadata",
        "impact",
        "rootCause",
      ];
      for (const field of forbiddenFields) {
        expect((incident as Record<string, unknown>)[field]).toBeUndefined();
      }
    }
  });

  it("TEST-SEED-SCHEMA-003: incident title and description conform to string length contracts", () => {
    for (const incident of incidents) {
      // Title: 5 to 120 chars, non-numeric
      expect(incident.title.length).toBeGreaterThanOrEqual(5);
      expect(incident.title.length).toBeLessThanOrEqual(120);
      expect(isNaN(Number(incident.title.trim()))).toBe(true);

      // Description: 20 to 2000 chars
      expect(incident.description.length).toBeGreaterThanOrEqual(20);
      expect(incident.description.length).toBeLessThanOrEqual(2000);
      expect(incident.description.trim().length).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("TASK-BE-002: Temporal Invariants & Chronological Sequencing", () => {
  let incidents: Incident[];

  beforeAll(() => {
    incidents = generateSeedIncidents();
  });

  it("TEST-SEED-004: timestamps are valid ISO 8601 UTC strings and updatedAt >= createdAt", () => {
    for (const incident of incidents) {
      const createdMs = Date.parse(incident.createdAt);
      const updatedMs = Date.parse(incident.updatedAt);

      expect(Number.isNaN(createdMs)).toBe(false);
      expect(Number.isNaN(updatedMs)).toBe(false);

      // ISO UTC formatting check (must end with Z)
      expect(incident.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      expect(incident.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

      // Strict temporal invariant: updatedAt >= createdAt
      expect(updatedMs).toBeGreaterThanOrEqual(createdMs);
    }
  });

  it("TEST-SEED-TIME-002: investigation notes timestamps fall chronologically between createdAt and updatedAt", () => {
    for (const incident of incidents) {
      const createdMs = Date.parse(incident.createdAt);
      const updatedMs = Date.parse(incident.updatedAt);

      for (const note of incident.notes) {
        const noteCreatedMs = Date.parse(note.createdAt);
        expect(Number.isNaN(noteCreatedMs)).toBe(false);
        expect(note.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

        // Note timestamp must fall inside [createdAt, updatedAt]
        expect(noteCreatedMs).toBeGreaterThanOrEqual(createdMs);
        expect(noteCreatedMs).toBeLessThanOrEqual(updatedMs);
      }
    }
  });

  it("TEST-SEED-TIME-003: multiple notes within an incident are ordered in ascending chronological order", () => {
    for (const incident of incidents) {
      if (incident.notes.length > 1) {
        for (let i = 0; i < incident.notes.length - 1; i++) {
          const currentNoteMs = Date.parse(incident.notes[i].createdAt);
          const nextNoteMs = Date.parse(incident.notes[i + 1].createdAt);
          expect(currentNoteMs).toBeLessThanOrEqual(nextNoteMs);
        }
      }
    }
  });
});

describe("TASK-BE-002: Investigation Notes Count & Entity Integrity", () => {
  let incidents: Incident[];

  beforeAll(() => {
    incidents = generateSeedIncidents();
  });

  it("TEST-SEED-009: every incident contains between 0 and 6 notes with full contract integrity", () => {
    const validUserIds = new Set(MOCK_USERS.map((u) => u.id));
    const allowedNoteKeys = ["author", "createdAt", "id", "incidentId", "message"].sort();

    for (const incident of incidents) {
      expect(incident.notes.length).toBeGreaterThanOrEqual(0);
      expect(incident.notes.length).toBeLessThanOrEqual(6);

      for (const note of incident.notes) {
        // Schema parse checks
        expect(() => IncidentNoteSchema.parse(note)).not.toThrow();
        expect(() => IncidentNoteSchema.strict().parse(note)).not.toThrow();

        // Exact keys
        expect(Object.keys(note).sort()).toEqual(allowedNoteKeys);

        // Association
        expect(note.incidentId).toBe(incident.id);
        expect(note.id.trim().length).toBeGreaterThan(0);

        // Author
        expect(validUserIds.has(note.author.id)).toBe(true);
        expect(() => UserSummarySchema.strict().parse(note.author)).not.toThrow();

        // Message
        expect(note.message.trim().length).toBeGreaterThan(0);
        expect(note.message.length).toBeLessThanOrEqual(5000);
      }
    }
  });

  it("TEST-SEED-NOTES-002: notes count distribution covers the full [0, 6] range across the dataset", () => {
    const notesCountFreq = new Map<number, number>();
    for (let c = 0; c <= 6; c++) {
      notesCountFreq.set(c, 0);
    }

    for (const incident of incidents) {
      const count = incident.notes.length;
      notesCountFreq.set(count, (notesCountFreq.get(count) ?? 0) + 1);
    }

    // Verify all counts from 0 to 6 are represented in the dataset
    for (let c = 0; c <= 6; c++) {
      const occurrences = notesCountFreq.get(c) ?? 0;
      expect(occurrences).toBeGreaterThan(0);
    }

    // Average notes count should be around 3 (uniform 0 to 6)
    const totalNotes = incidents.reduce((sum, inc) => sum + inc.notes.length, 0);
    const avgNotes = totalNotes / incidents.length;
    expect(avgNotes).toBeGreaterThan(2.3);
    expect(avgNotes).toBeLessThan(3.7);
  });
});

describe("TASK-BE-002: Statistical Distributions", () => {
  let incidents: Incident[];
  const total = 1048;

  beforeAll(() => {
    incidents = generateSeedIncidents();
  });

  it("TEST-SEED-005: monitored services distribution adheres to target percentage margins", () => {
    expect(incidents).toHaveLength(total);

    const serviceCounts: Record<string, number> = {};
    for (const s of MOCK_SERVICES) {
      serviceCounts[s] = 0;
    }

    for (const incident of incidents) {
      expect(serviceCounts).toHaveProperty(incident.service);
      serviceCounts[incident.service]++;
    }

    // Target distributions:
    // payments-api: 20% (17%–23% -> 178 - 241)
    // checkout-web: 20% (17%–23% -> 178 - 241)
    // identity-service: 15% (12%–18% -> 125 - 189)
    // notification-worker: 15% (12%–18% -> 125 - 189)
    // reporting-api: 10% (7%–13% -> 73 - 137)
    // auth-gateway: 10% (7%–13% -> 73 - 137)
    // inventory-service: 10% (7%–13% -> 73 - 137)

    const paymentsPct = (serviceCounts["payments-api"] / total) * 100;
    const checkoutPct = (serviceCounts["checkout-web"] / total) * 100;
    const identityPct = (serviceCounts["identity-service"] / total) * 100;
    const notificationPct = (serviceCounts["notification-worker"] / total) * 100;
    const reportingPct = (serviceCounts["reporting-api"] / total) * 100;
    const authPct = (serviceCounts["auth-gateway"] / total) * 100;
    const inventoryPct = (serviceCounts["inventory-service"] / total) * 100;

    expect(paymentsPct).toBeGreaterThanOrEqual(17);
    expect(paymentsPct).toBeLessThanOrEqual(23);

    expect(checkoutPct).toBeGreaterThanOrEqual(17);
    expect(checkoutPct).toBeLessThanOrEqual(23);

    expect(identityPct).toBeGreaterThanOrEqual(12);
    expect(identityPct).toBeLessThanOrEqual(18);

    expect(notificationPct).toBeGreaterThanOrEqual(12);
    expect(notificationPct).toBeLessThanOrEqual(18);

    expect(reportingPct).toBeGreaterThanOrEqual(7);
    expect(reportingPct).toBeLessThanOrEqual(13);

    expect(authPct).toBeGreaterThanOrEqual(7);
    expect(authPct).toBeLessThanOrEqual(13);

    expect(inventoryPct).toBeGreaterThanOrEqual(7);
    expect(inventoryPct).toBeLessThanOrEqual(13);

    const sumCounts = Object.values(serviceCounts).reduce((a, b) => a + b, 0);
    expect(sumCounts).toBe(total);
  });

  it("TEST-SEED-006: severity distribution adheres to target percentage margins", () => {
    const severityCounts: Record<IncidentSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const incident of incidents) {
      severityCounts[incident.severity]++;
    }

    // Target distributions:
    // critical: 10% (8%–12%)
    // high: 25% (22%–28%)
    // medium: 40% (36%–44%)
    // low: 25% (22%–28%)

    const criticalPct = (severityCounts.critical / total) * 100;
    const highPct = (severityCounts.high / total) * 100;
    const mediumPct = (severityCounts.medium / total) * 100;
    const lowPct = (severityCounts.low / total) * 100;

    expect(criticalPct).toBeGreaterThanOrEqual(8);
    expect(criticalPct).toBeLessThanOrEqual(12);

    expect(highPct).toBeGreaterThanOrEqual(22);
    expect(highPct).toBeLessThanOrEqual(28);

    expect(mediumPct).toBeGreaterThanOrEqual(36);
    expect(mediumPct).toBeLessThanOrEqual(44);

    expect(lowPct).toBeGreaterThanOrEqual(22);
    expect(lowPct).toBeLessThanOrEqual(28);

    const sumCounts = Object.values(severityCounts).reduce((a, b) => a + b, 0);
    expect(sumCounts).toBe(total);
  });

  it("TEST-SEED-007: status distribution adheres to target percentage margins", () => {
    const statusCounts: Record<IncidentStatus, number> = {
      triggered: 0,
      acknowledged: 0,
      investigating: 0,
      resolved: 0,
    };

    for (const incident of incidents) {
      statusCounts[incident.status]++;
    }

    // Target distributions:
    // triggered: 15% (12%–18%)
    // acknowledged: 25% (22%–28%)
    // investigating: 35% (31%–39%)
    // resolved: 25% (22%–28%)

    const triggeredPct = (statusCounts.triggered / total) * 100;
    const acknowledgedPct = (statusCounts.acknowledged / total) * 100;
    const investigatingPct = (statusCounts.investigating / total) * 100;
    const resolvedPct = (statusCounts.resolved / total) * 100;

    expect(triggeredPct).toBeGreaterThanOrEqual(12);
    expect(triggeredPct).toBeLessThanOrEqual(18);

    expect(acknowledgedPct).toBeGreaterThanOrEqual(22);
    expect(acknowledgedPct).toBeLessThanOrEqual(28);

    expect(investigatingPct).toBeGreaterThanOrEqual(31);
    expect(investigatingPct).toBeLessThanOrEqual(39);

    expect(resolvedPct).toBeGreaterThanOrEqual(22);
    expect(resolvedPct).toBeLessThanOrEqual(28);

    const sumCounts = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    expect(sumCounts).toBe(total);
  });

  it("TEST-SEED-008: operator assignee allocation adheres to 80% assigned / 20% unassigned distribution", () => {
    let unassignedCount = 0;
    let assignedCount = 0;
    const userAssignmentCounts: Record<string, number> = {};

    for (const user of MOCK_USERS) {
      userAssignmentCounts[user.id] = 0;
    }

    for (const incident of incidents) {
      if (incident.assignee === null) {
        unassignedCount++;
      } else {
        assignedCount++;
        expect(userAssignmentCounts).toHaveProperty(incident.assignee.id);
        userAssignmentCounts[incident.assignee.id]++;

        // Verify assignee snapshot matches MOCK_USERS entry
        const mockUser = MOCK_USERS.find((u) => u.id === incident.assignee?.id);
        expect(mockUser).toBeDefined();
        expect(incident.assignee.name).toBe(mockUser!.name);
        expect(incident.assignee.email).toBe(mockUser!.email);
      }
    }

    expect(unassignedCount + assignedCount).toBe(total);

    // Unassigned target: 20% (17%–23% -> 178 - 241)
    const unassignedPct = (unassignedCount / total) * 100;
    expect(unassignedPct).toBeGreaterThanOrEqual(17);
    expect(unassignedPct).toBeLessThanOrEqual(23);

    // Assigned target: 80% (77%–83% -> 807 - 870)
    const assignedPct = (assignedCount / total) * 100;
    expect(assignedPct).toBeGreaterThanOrEqual(77);
    expect(assignedPct).toBeLessThanOrEqual(83);

    // Ensure all 10 mock users are assigned to at least some incidents
    for (const user of MOCK_USERS) {
      expect(userAssignmentCounts[user.id]).toBeGreaterThan(0);
    }
  });
});
