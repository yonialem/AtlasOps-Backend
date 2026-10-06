import { describe, it, expect, beforeEach } from "vitest";
import http from "node:http";
import { Socket } from "node:net";
import { app } from "../src/index.ts";
import { store } from "../src/db/store.ts";
import { MOCK_SERVICES, MOCK_USERS } from "../src/db/seed.ts";
import {
  IncidentSchema,
  IncidentNoteSchema,
  Incident,
  IncidentNote,
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

/**
 * ============================================================================
 * TASK-BE-007: End-to-End HTTP API Test Suite (TEST-BE-007 through TEST-BE-012)
 * ============================================================================
 * Author: BE Test Writer Agent
 * File: backend/tests/api.test.ts
 *
 * Verifies the full REST API endpoints contract:
 * - TEST-BE-007: GET /api/incidents/:id (200 OK with full incident, 404 on missing)
 * - TEST-BE-008: POST /api/incidents validation (title, description, sequential ID, version 1)
 * - TEST-BE-009: POST /api/incidents rejection of resolved initial status
 * - TEST-BE-010: PATCH /api/incidents/:id/status (version increment, lifecycle, 409 conflict)
 * - TEST-BE-011: PATCH /api/incidents/:id/assignee (assign operator, unassign with null, 400 on unknown)
 * - TEST-BE-012: POST /api/incidents/:id/notes (message validation, author, updatedAt)
 * - System directories: GET /api/services and GET /api/users
 */

function dispatchRequest(
  expressApp: any,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const req = new http.IncomingMessage(socket);
    req.method = method.toUpperCase();
    req.url = url;
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

      const responseHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.getHeaders())) {
        if (v !== undefined) responseHeaders[k.toLowerCase()] = String(v);
      }

      resolve({ status: res.statusCode, body: parsed, headers: responseHeaders });
    });

    res.on("error", reject);

    expressApp(req, res, (err: any) => {
      if (err) reject(err);
      else resolve({ status: 404, body: { code: "NOT_FOUND", message: "Not Found" }, headers: {} });
    });

    if (bodyStr) {
      req.push(bodyStr);
    }
    req.push(null);
  });
}

describe("TASK-BE-007: End-to-End HTTP API Contract (TEST-BE-007 through TEST-BE-012)", () => {
  beforeEach(() => {
    store.reset();
  });

  // --------------------------------------------------------------------------
  // TEST-BE-007: GET /api/incidents/:id
  // --------------------------------------------------------------------------
  describe("TEST-BE-007: Single Incident Retrieval", () => {
    it("returns HTTP 200 with full Incident object and notes array for existing ID", async () => {
      const { status, body } = await dispatchRequest(app, "GET", "/api/incidents/INC-1001");

      expect(status).toBe(200);
      expect(() => IncidentSchema.parse(body)).not.toThrow();
      expect(body.id).toBe("INC-1001");
      expect(body.version).toBeDefined();
      expect(Array.isArray(body.notes)).toBe(true);
      expect(body.title).toBeDefined();
      expect(body.service).toBeDefined();
      expect(body.status).toBeDefined();
      expect(body.severity).toBeDefined();
    });

    it("returns HTTP 404 with INCIDENT_NOT_FOUND code for non-existent incident", async () => {
      const { status, body } = await dispatchRequest(app, "GET", "/api/incidents/INC-9999");

      expect(status).toBe(404);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("INCIDENT_NOT_FOUND");
      expect(body.message).toContain("does not exist");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-BE-008: POST /api/incidents (Validation & Creation)
  // --------------------------------------------------------------------------
  describe("TEST-BE-008: Incident Creation Validation", () => {
    it("creates an incident with 201 Created, sequential ID, version 1, and empty notes", async () => {
      const payload: IncidentCreateInput = {
        title: "Database connection pool exhaustion on payments-api ingress",
        description: "Postgres primary connection pool exhausted under surge traffic load.",
        status: "triggered",
        severity: "critical",
        service: "payments-api",
        assigneeId: "usr-1",
      };

      const initialCount = store.count();
      const { status, body } = await dispatchRequest(app, "POST", "/api/incidents", payload);

      expect(status).toBe(201);
      expect(() => IncidentSchema.parse(body)).not.toThrow();
      expect(body.id).toBe("INC-2049");
      expect(body.title).toBe(payload.title);
      expect(body.description).toBe(payload.description);
      expect(body.status).toBe("triggered");
      expect(body.severity).toBe("critical");
      expect(body.version).toBe(1);
      expect(body.notes).toEqual([]);
      expect(body.assignee?.id).toBe("usr-1");
      expect(store.count()).toBe(initialCount + 1);
    });

    it("returns HTTP 400 Bad Request when title is less than 5 characters", async () => {
      const { status, body } = await dispatchRequest(app, "POST", "/api/incidents", {
        title: "Down",
        description: "Database connection pool exhausted under surge traffic load.",
        service: "payments-api",
      });

      expect(status).toBe(400);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.fieldErrors).toHaveProperty("title");
    });

    it("returns HTTP 400 Bad Request when title is purely numeric", async () => {
      const { status, body } = await dispatchRequest(app, "POST", "/api/incidents", {
        title: "12345678",
        description: "Database connection pool exhausted under surge traffic load.",
        service: "payments-api",
      });

      expect(status).toBe(400);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.fieldErrors).toHaveProperty("title");
    });

    it("returns HTTP 400 Bad Request when description is less than 20 characters", async () => {
      const { status, body } = await dispatchRequest(app, "POST", "/api/incidents", {
        title: "Valid title for database failure",
        description: "Too short",
        service: "payments-api",
      });

      expect(status).toBe(400);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.fieldErrors).toHaveProperty("description");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-BE-009: POST /api/incidents (Rejection of Initial Resolved Status)
  // --------------------------------------------------------------------------
  describe("TEST-BE-009: Rejection of Initial Resolved Status", () => {
    it("rejects initial status 'resolved' with 400 Bad Request and does not create incident", async () => {
      const initialCount = store.count();

      const { status, body } = await dispatchRequest(app, "POST", "/api/incidents", {
        title: "Prematurely marked resolved incident",
        description: "Attempting to create an incident that starts in resolved state directly.",
        status: "resolved",
        service: "payments-api",
      });

      expect(status).toBe(400);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fieldErrors).toHaveProperty("status");
      expect(store.count()).toBe(initialCount);
    });
  });

  // --------------------------------------------------------------------------
  // TEST-BE-010: PATCH /api/incidents/:id/status (Lifecycle & Concurrency)
  // --------------------------------------------------------------------------
  describe("TEST-BE-010: Status Lifecycle & Optimistic Concurrency", () => {
    it("transitions status, increments version, and updates updatedAt", async () => {
      const target = store.getAll().find((inc) => inc.status === "triggered");
      expect(target).toBeDefined();

      const targetId = target!.id;
      const initialVersion = target!.version;

      const { status, body } = await dispatchRequest(
        app,
        "PATCH",
        `/api/incidents/${targetId}/status`,
        {
          status: "acknowledged",
          version: initialVersion,
        }
      );

      expect(status).toBe(200);
      expect(() => UpdateIncidentStatusResponseSchema.parse(body)).not.toThrow();
      expect(body.id).toBe(targetId);
      expect(body.status).toBe("acknowledged");
      expect(body.version).toBe(initialVersion + 1);

      // Verify state in store
      const inStore = store.findById(targetId);
      expect(inStore!.status).toBe("acknowledged");
      expect(inStore!.version).toBe(initialVersion + 1);
    });

    it("returns HTTP 409 Conflict with INCIDENT_VERSION_CONFLICT when version mismatches", async () => {
      const target = store.getAll().find((inc) => inc.status === "triggered");
      const targetId = target!.id;

      // Advance version on server
      await dispatchRequest(app, "PATCH", `/api/incidents/${targetId}/status`, {
        status: "acknowledged",
      });

      // Second client attempts update with stale version
      const { status, body } = await dispatchRequest(
        app,
        "PATCH",
        `/api/incidents/${targetId}/status`,
        {
          status: "investigating",
          version: 1, // Stale! Server is now at version 2
        }
      );

      expect(status).toBe(409);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("INCIDENT_VERSION_CONFLICT");
      expect(body.currentVersion).toBeDefined();
    });

    it("rejects illegal lifecycle transition (triggered -> resolved) with HTTP 400 INVALID_TRANSITION", async () => {
      const target = store.getAll().find((inc) => inc.status === "triggered");
      const targetId = target!.id;

      const { status, body } = await dispatchRequest(
        app,
        "PATCH",
        `/api/incidents/${targetId}/status`,
        {
          status: "resolved",
        }
      );

      expect(status).toBe(400);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("INVALID_TRANSITION");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-BE-011: PATCH /api/incidents/:id/assignee (Ownership)
  // --------------------------------------------------------------------------
  describe("TEST-BE-011: Ownership Assignment & Unassign", () => {
    it("assigns valid operator from MOCK_USERS and increments version", async () => {
      const { status, body } = await dispatchRequest(
        app,
        "PATCH",
        "/api/incidents/INC-1001/assignee",
        {
          assigneeId: "usr-2",
        }
      );

      expect(status).toBe(200);
      expect(() => IncidentSchema.parse(body)).not.toThrow();
      expect(body.assignee?.id).toBe("usr-2");
      expect(body.assignee?.name).toBe("Daniel Brooks");
    });

    it("unassigns operator when assigneeId is null", async () => {
      const { status, body } = await dispatchRequest(
        app,
        "PATCH",
        "/api/incidents/INC-1001/assignee",
        {
          assigneeId: null,
        }
      );

      expect(status).toBe(200);
      expect(() => IncidentSchema.parse(body)).not.toThrow();
      expect(body.assignee).toBeNull();
    });

    it("rejects non-existent assigneeId with HTTP 400 USER_NOT_FOUND", async () => {
      const { status, body } = await dispatchRequest(
        app,
        "PATCH",
        "/api/incidents/INC-1001/assignee",
        {
          assigneeId: "usr-unknown-999",
        }
      );

      expect(status).toBe(400);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("USER_NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-BE-012: POST /api/incidents/:id/notes (Investigation Notes)
  // --------------------------------------------------------------------------
  describe("TEST-BE-012: Add Investigation Note", () => {
    it("appends note to incident, returns 201 Created, and updates incident updatedAt", async () => {
      const incidentBefore = store.findById("INC-1001");
      const initialNotesCount = incidentBefore!.notes.length;

      const { status, body } = await dispatchRequest(
        app,
        "POST",
        "/api/incidents/INC-1001/notes",
        {
          message: "Root cause isolated to upstream payment gateway latency.",
        }
      );

      expect(status).toBe(201);
      expect(() => IncidentNoteSchema.parse(body)).not.toThrow();
      expect(body.incidentId).toBe("INC-1001");
      expect(body.message).toBe("Root cause isolated to upstream payment gateway latency.");
      expect(body.id).toBeDefined();
      expect(body.author).toBeDefined();
      expect(body.createdAt).toBeDefined();

      const incidentAfter = store.findById("INC-1001");
      expect(incidentAfter!.notes).toHaveLength(initialNotesCount + 1);
      expect(incidentAfter!.updatedAt).toBe(body.createdAt);
    });

    it("rejects empty or whitespace note message with HTTP 400 Bad Request", async () => {
      const { status, body } = await dispatchRequest(
        app,
        "POST",
        "/api/incidents/INC-1001/notes",
        {
          message: "   ",
        }
      );

      expect(status).toBe(400);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    });

    it("returns HTTP 404 INCIDENT_NOT_FOUND when adding note to non-existent incident", async () => {
      const { status, body } = await dispatchRequest(
        app,
        "POST",
        "/api/incidents/INC-9999/notes",
        {
          message: "Valid note text.",
        }
      );

      expect(status).toBe(404);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("INCIDENT_NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // System Directories: GET /api/services & GET /api/users
  // --------------------------------------------------------------------------
  describe("System Directories: Services and Users", () => {
    it("GET /api/services returns array containing all 7 monitored services", async () => {
      const { status, body } = await dispatchRequest(app, "GET", "/api/services");

      expect(status).toBe(200);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items).toHaveLength(7);
      expect(body.items).toEqual(MOCK_SERVICES);
    });

    it("GET /api/users returns array containing all 10 mock users", async () => {
      const { status, body } = await dispatchRequest(app, "GET", "/api/users");

      expect(status).toBe(200);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items).toHaveLength(10);
      expect(body.items).toEqual(MOCK_USERS);
    });
  });
});
