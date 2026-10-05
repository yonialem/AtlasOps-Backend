import { describe, it, expect, beforeEach } from "vitest";
import { Readable, Writable } from "node:stream";
import {
  IncidentStore,
  store,
} from "../src/db/store.ts";
import { app } from "../src/index.ts";
import {
  Incident,
  IncidentSchema,
  IncidentNote,
  IncidentNoteSchema,
  UserSummarySchema,
  IncidentCreateInput,
  IncidentStatusUpdateInput,
  IncidentAssigneeUpdateInput,
  IncidentNoteCreateInput,
} from "../src/contracts/incident.types.ts";
import {
  ApiErrorEnvelopeSchema,
  ApiErrorEnvelope,
  UpdateIncidentStatusResponseSchema,
  UpdateIncidentStatusResponse,
} from "../src/contracts/api.types.ts";
import { MOCK_USERS } from "../src/db/seed.ts";

/**
 * ============================================================================
 * TASK-BE-004: Mutation Handlers & Optimistic Concurrency - Test Suite
 * ============================================================================
 * Author: BE Test Writer Agent
 * File: backend/tests/mutations.test.ts
 *
 * Verifies:
 * 1. POST /api/incidents: creation, schema validation, ID sequencing, resolved status rejection.
 * 2. PATCH /api/incidents/:id/status: lifecycle transition rules, version checks, 409 conflict, 404 missing.
 * 3. PATCH /api/incidents/:id/assignee: assign operator, unassign, unknown user 400, version conflict 409, 404.
 * 4. POST /api/incidents/:id/notes: append investigation note, author attribution, updatedAt advancement, validation 400, 404.
 * 5. Direct store mutation methods.
 */

import http from "node:http";
import { Socket } from "node:net";

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const req = new http.IncomingMessage(socket);
    req.method = method.toUpperCase();
    req.url = path;
    const bodyStr = body !== undefined ? JSON.stringify(body) : "";
    req.headers = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(bodyStr).toString(),
      ...headers,
    };

    const res = new http.ServerResponse(req);
    res.assignSocket(socket as any);

    const chunks: Buffer[] = [];
    socket.write = (chunk: any, encoding?: any, cb?: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    };

    res.on("finish", () => {
      const fullText = Buffer.concat(chunks).toString("utf8");
      const splitIdx = fullText.indexOf("\r\n\r\n");
      const bodyText = splitIdx !== -1 ? fullText.slice(splitIdx + 4) : fullText;
      let parsed = bodyText;
      try {
        parsed = JSON.parse(bodyText);
      } catch {}
      resolve({ status: res.statusCode, body: parsed });
    });

    res.on("error", reject);

    app(req, res, (err: any) => {
      if (err) reject(err);
      else resolve({ status: 404, body: { code: "NOT_FOUND", message: "Not Found" } });
    });

    if (bodyStr) {
      req.push(bodyStr);
    }
    req.push(null);
  });
}

describe("TASK-BE-004: POST /api/incidents (Create Incident)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-MUT-001: creates incident with 201 Created, sequential ID, version 1, and empty notes", async () => {
    const payload: IncidentCreateInput = {
      title: "Elevated payment authorization failure rate in EU region",
      description: "Payment authorization failures spiked above the 5 percent baseline SLA threshold.",
      status: "triggered",
      severity: "high",
      service: "payments-api",
      assigneeId: "usr-1",
    };

    const initialCount = store.count();
    const { status, body } = await request("POST", "/api/incidents", payload);

    expect(status).toBe(201);
    expect(() => IncidentSchema.parse(body)).not.toThrow();

    // ID should follow 1048 seed items (INC-1001 through INC-2048)
    expect(body.id).toBe("INC-2049");
    expect(body.title).toBe(payload.title);
    expect(body.description).toBe(payload.description);
    expect(body.status).toBe("triggered");
    expect(body.severity).toBe("high");
    expect(body.service).toBe("payments-api");
    expect(body.version).toBe(1);
    expect(body.notes).toEqual([]);

    // Timestamps
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(body.updatedAt).toBe(body.createdAt);

    // Assignee resolved
    expect(body.assignee).not.toBeNull();
    expect(body.assignee.id).toBe("usr-1");
    expect(body.assignee.name).toBe("Maya Chen");

    // Store state updated
    expect(store.count()).toBe(initialCount + 1);
    expect(store.findById("INC-2049")).toBeDefined();
  });

  it("TEST-MUT-001-B: creates incident without assignee (unassigned null)", async () => {
    const payload = {
      title: "Cassandra ring node timeout in US-East data center",
      description: "Multiple node communication heartbeats failed across the Cassandra ring cluster.",
      status: "investigating",
      severity: "critical",
      service: "identity-service",
      assigneeId: null,
    };

    const { status, body } = await request("POST", "/api/incidents", payload);
    expect(status).toBe(201);
    expect(body.assignee).toBeNull();
    expect(body.status).toBe("investigating");
    expect(body.severity).toBe("critical");
  });

  it("TEST-MUT-001-C: generates sequential IDs across multiple consecutive creations", async () => {
    const p1 = {
      title: "First created incident in sequence verification",
      description: "First incident created to verify incremental sequential ID allocation.",
      service: "checkout-web",
    };
    const p2 = {
      title: "Second created incident in sequence verification",
      description: "Second incident created to verify incremental sequential ID allocation.",
      service: "reporting-api",
    };

    const res1 = await request("POST", "/api/incidents", p1);
    const res2 = await request("POST", "/api/incidents", p2);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.id).toBe("INC-2049");
    expect(res2.body.id).toBe("INC-2050");
  });

  it("TEST-MUT-002: returns 400 Bad Request with fieldErrors on invalid title or description", async () => {
    // Short title (< 5 chars)
    const shortTitleRes = await request("POST", "/api/incidents", {
      title: "Down",
      description: "Database connection pool saturated completely.",
      service: "auth-gateway",
    });
    expect(shortTitleRes.status).toBe(400);
    expect(() => ApiErrorEnvelopeSchema.parse(shortTitleRes.body)).not.toThrow();
    expect(shortTitleRes.body.fieldErrors).toHaveProperty("title");

    // Purely numeric title
    const numericTitleRes = await request("POST", "/api/incidents", {
      title: "12345678",
      description: "Database connection pool saturated completely.",
      service: "auth-gateway",
    });
    expect(numericTitleRes.status).toBe(400);
    expect(numericTitleRes.body.fieldErrors).toHaveProperty("title");

    // Short description (< 20 chars)
    const shortDescRes = await request("POST", "/api/incidents", {
      title: "Database connection pool saturated",
      description: "Too short",
      service: "auth-gateway",
    });
    expect(shortDescRes.status).toBe(400);
    expect(shortDescRes.body.fieldErrors).toHaveProperty("description");

    // Invalid severity
    const invalidSevRes = await request("POST", "/api/incidents", {
      title: "Database connection pool saturated",
      description: "Database connection pool saturated completely across all replicas.",
      service: "auth-gateway",
      severity: "ultra-critical",
    });
    expect(invalidSevRes.status).toBe(400);
  });

  it("TEST-MUT-003: rejects creation with initial status 'resolved' (returns 400 with VALIDATION_ERROR)", async () => {
    const payload = {
      title: "Resolved alert that should not be created directly",
      description: "Attempting to create an incident that is immediately marked as resolved.",
      status: "resolved",
      service: "payments-api",
    };

    const { status, body } = await request("POST", "/api/incidents", payload);
    expect(status).toBe(400);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fieldErrors).toHaveProperty("status");
  });
});

describe("TASK-BE-004: PATCH /api/incidents/:id/status (Lifecycle & Concurrency)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-MUT-004: successfully transitions status, increments version, and updates updatedAt", async () => {
    // Find an incident with initial status 'triggered'
    const target = store.getAll().find((inc) => inc.status === "triggered");
    expect(target).toBeDefined();

    const targetId = target!.id;
    const initialVersion = target!.version;
    const initialUpdatedAt = target!.updatedAt;

    const payload: IncidentStatusUpdateInput = {
      status: "acknowledged",
      version: initialVersion,
    };

    const { status, body } = await request("PATCH", `/api/incidents/${targetId}/status`, payload);

    expect(status).toBe(200);
    expect(() => UpdateIncidentStatusResponseSchema.parse(body)).not.toThrow();
    expect(body.id).toBe(targetId);
    expect(body.status).toBe("acknowledged");
    expect(body.version).toBe(initialVersion + 1);

    // updatedAt should be updated to a newer timestamp
    const updatedMs = Date.parse(body.updatedAt);
    const initialMs = Date.parse(initialUpdatedAt);
    expect(updatedMs).toBeGreaterThanOrEqual(initialMs);

    // Verify in-memory store reflects update
    const updatedInStore = store.findById(targetId);
    expect(updatedInStore!.status).toBe("acknowledged");
    expect(updatedInStore!.version).toBe(initialVersion + 1);
  });

  it("TEST-MUT-004-B: supports multi-step lifecycle progression (acknowledged -> investigating -> resolved)", async () => {
    const target = store.getAll().find((inc) => inc.status === "triggered");
    const targetId = target!.id;

    // 1. triggered -> acknowledged (v1 -> v2)
    const step1 = await request("PATCH", `/api/incidents/${targetId}/status`, {
      status: "acknowledged",
      version: target!.version,
    });
    expect(step1.status).toBe(200);
    expect(step1.body.version).toBe(target!.version + 1);

    // 2. acknowledged -> investigating (v2 -> v3)
    const step2 = await request("PATCH", `/api/incidents/${targetId}/status`, {
      status: "investigating",
      version: step1.body.version,
    });
    expect(step2.status).toBe(200);
    expect(step2.body.status).toBe("investigating");
    expect(step2.body.version).toBe(step1.body.version + 1);

    // 3. investigating -> resolved (v3 -> v4)
    const step3 = await request("PATCH", `/api/incidents/${targetId}/status`, {
      status: "resolved",
      version: step2.body.version,
    });
    expect(step3.status).toBe(200);
    expect(step3.body.status).toBe("resolved");
    expect(step3.body.version).toBe(step2.body.version + 1);
  });

  it("TEST-MUT-005: rejects illegal status transition (e.g. triggered directly to resolved) with 400 INVALID_TRANSITION", async () => {
    const target = store.getAll().find((inc) => inc.status === "triggered");
    expect(target).toBeDefined();

    const targetId = target!.id;
    const initialVersion = target!.version;

    // triggered -> resolved is strictly prohibited
    const { status, body } = await request("PATCH", `/api/incidents/${targetId}/status`, {
      status: "resolved",
      version: initialVersion,
    });

    expect(status).toBe(400);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INVALID_TRANSITION");

    // Incident state must not be modified
    const untouched = store.findById(targetId);
    expect(untouched!.status).toBe("triggered");
    expect(untouched!.version).toBe(initialVersion);
  });

  it("TEST-MUT-006: returns 409 Conflict with INCIDENT_VERSION_CONFLICT and currentVersion on version mismatch", async () => {
    const target = store.getAll().find((inc) => inc.status === "triggered");
    expect(target).toBeDefined();
    const targetId = target!.id;

    // Advance version on server to version 2
    await request("PATCH", `/api/incidents/${targetId}/status`, {
      status: "acknowledged",
    });

    // Client attempts update using stale version 1
    const { status, body } = await request("PATCH", `/api/incidents/${targetId}/status`, {
      status: "investigating",
      version: 1, // stale! Server is now at version 2
    });

    expect(status).toBe(409);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INCIDENT_VERSION_CONFLICT");
    expect(body.currentVersion).toBe(2);

    // Status remains acknowledged
    expect(store.findById(targetId)!.status).toBe("acknowledged");
  });

  it("TEST-MUT-007: returns 404 Not Found with INCIDENT_NOT_FOUND when incident does not exist", async () => {
    const { status, body } = await request("PATCH", "/api/incidents/INC-9999/status", {
      status: "acknowledged",
    });

    expect(status).toBe(404);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INCIDENT_NOT_FOUND");
  });
});

describe("TASK-BE-004: PATCH /api/incidents/:id/assignee (Ownership Update)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-MUT-008: assigns valid operator, advances version, updates updatedAt, and returns full Incident", async () => {
    const incident = store.findById("INC-1001");
    expect(incident).toBeDefined();
    const prevVersion = incident!.version;

    const payload: IncidentAssigneeUpdateInput = {
      assigneeId: "usr-2",
    };

    const { status, body } = await request("PATCH", "/api/incidents/INC-1001/assignee", payload);

    expect(status).toBe(200);
    expect(() => IncidentSchema.parse(body)).not.toThrow();
    expect(body.id).toBe("INC-1001");
    expect(body.assignee).not.toBeNull();
    expect(body.assignee.id).toBe("usr-2");
    expect(body.assignee.name).toBe("Daniel Brooks");
    expect(body.assignee.email).toBe("daniel.brooks@atlasops.io");
    expect(body.version).toBe(prevVersion + 1);

    // Store state verification
    const inStore = store.findById("INC-1001");
    expect(inStore!.assignee!.id).toBe("usr-2");
    expect(inStore!.version).toBe(prevVersion + 1);
  });

  it("TEST-MUT-009: unassigns incident when assigneeId is null", async () => {
    // Find an assigned incident
    const assigned = store.getAll().find((inc) => inc.assignee !== null);
    expect(assigned).toBeDefined();
    const id = assigned!.id;
    const prevVersion = assigned!.version;

    const { status, body } = await request("PATCH", `/api/incidents/${id}/assignee`, {
      assigneeId: null,
    });

    expect(status).toBe(200);
    expect(() => IncidentSchema.parse(body)).not.toThrow();
    expect(body.assignee).toBeNull();
    expect(body.version).toBe(prevVersion + 1);

    expect(store.findById(id)!.assignee).toBeNull();
  });

  it("TEST-MUT-010: returns 400 Bad Request with USER_NOT_FOUND when assigneeId does not exist", async () => {
    const { status, body } = await request("PATCH", "/api/incidents/INC-1001/assignee", {
      assigneeId: "usr-unknown-999",
    });

    expect(status).toBe(400);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("USER_NOT_FOUND");
  });

  it("TEST-MUT-010-B: returns 409 Conflict if assignee update provides stale version", async () => {
    const incident = store.findById("INC-1001");
    const currentVersion = incident!.version;

    const { status, body } = await request("PATCH", "/api/incidents/INC-1001/assignee", {
      assigneeId: "usr-3",
      version: currentVersion - 1, // stale version
    });

    expect(status).toBe(409);
    expect(body.code).toBe("INCIDENT_VERSION_CONFLICT");
    expect(body.currentVersion).toBe(currentVersion);
  });

  it("TEST-MUT-010-C: returns 404 Not Found when updating assignee on missing incident", async () => {
    const { status, body } = await request("PATCH", "/api/incidents/INC-9999/assignee", {
      assigneeId: "usr-1",
    });

    expect(status).toBe(404);
    expect(body.code).toBe("INCIDENT_NOT_FOUND");
  });
});

describe("TASK-BE-004: POST /api/incidents/:id/notes (Append Investigation Note)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-MUT-011: appends note with 201 Created, sets author and timestamp, and advances incident updatedAt", async () => {
    const incident = store.findById("INC-1001");
    expect(incident).toBeDefined();
    const initialNotesCount = incident!.notes.length;
    const initialUpdatedAt = incident!.updatedAt;

    const payload: IncidentNoteCreateInput = {
      message: "Investigating gateway ingress 504 timeouts and thread pool contention.",
    };

    const { status, body } = await request("POST", "/api/incidents/INC-1001/notes", payload);

    expect(status).toBe(201);
    expect(() => IncidentNoteSchema.parse(body)).not.toThrow();
    expect(body.incidentId).toBe("INC-1001");
    expect(body.message).toBe(payload.message);
    expect(body.id).toMatch(/^note-/);
    expect(body.author).toBeDefined();
    expect(body.author.id).toMatch(/^usr-/);
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

    // Verify incident updated in store
    const updatedIncident = store.findById("INC-1001");
    expect(updatedIncident!.notes).toHaveLength(initialNotesCount + 1);
    expect(updatedIncident!.notes[updatedIncident!.notes.length - 1].message).toBe(payload.message);
    expect(updatedIncident!.updatedAt).toBe(body.createdAt);
  });

  it("TEST-MUT-012: rejects empty or whitespace-only note message with 400 Bad Request", async () => {
    // Empty message
    const emptyRes = await request("POST", "/api/incidents/INC-1001/notes", {
      message: "",
    });
    expect(emptyRes.status).toBe(400);
    expect(() => ApiErrorEnvelopeSchema.parse(emptyRes.body)).not.toThrow();

    // Whitespace only message
    const wsRes = await request("POST", "/api/incidents/INC-1001/notes", {
      message: "    \n\t   ",
    });
    expect(wsRes.status).toBe(400);
    expect(() => ApiErrorEnvelopeSchema.parse(wsRes.body)).not.toThrow();
  });

  it("TEST-MUT-013: returns 404 Not Found when adding note to non-existent incident", async () => {
    const { status, body } = await request("POST", "/api/incidents/INC-9999/notes", {
      message: "Note for a non-existent incident.",
    });

    expect(status).toBe(404);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INCIDENT_NOT_FOUND");
  });
});

describe("TASK-BE-004: Direct Store Mutation Methods", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-MUT-001: store.create() creates incident and stores it directly", () => {
    const initialCount = store.count();
    const created = store.create({
      title: "Direct store create unit test incident",
      description: "Direct store method invocation for verifying unit-level mutation API.",
      status: "triggered",
      severity: "medium",
      service: "inventory-service",
    });

    expect(created.id).toBe("INC-2049");
    expect(store.count()).toBe(initialCount + 1);
    expect(store.findById("INC-2049")).toEqual(created);
  });

  it("TEST-STORE-MUT-002: store.updateStatus() advances version and updates status", () => {
    const target = store.getAll().find((inc) => inc.status === "triggered");
    expect(target).toBeDefined();

    const res = store.updateStatus(target!.id, {
      status: "acknowledged",
    });

    expect(res.status).toBe("acknowledged");
    expect(res.version).toBe(target!.version + 1);
  });

  it("TEST-STORE-MUT-003: store.updateAssignee() updates and clears assignee", () => {
    const assigned = store.updateAssignee("INC-1001", {
      assigneeId: "usr-4",
    });
    expect(assigned.assignee?.id).toBe("usr-4");

    const cleared = store.updateAssignee("INC-1001", {
      assigneeId: null,
    });
    expect(cleared.assignee).toBeNull();
  });

  it("TEST-STORE-MUT-004: store.createNote() appends note and updates incident updatedAt", () => {
    const incident = store.findById("INC-1001");
    const prevCount = incident!.notes.length;

    const note = store.createNote("INC-1001", {
      message: "Direct note creation message.",
    });

    expect(note.incidentId).toBe("INC-1001");
    expect(incident!.notes).toHaveLength(prevCount + 1);
    expect(incident!.updatedAt).toBe(note.createdAt);
  });
});
