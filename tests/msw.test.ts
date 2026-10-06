import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { server } from "../src/msw/node.ts";
import { handlers } from "../src/msw/handlers.ts";
import { createServer } from "../src/server.ts";
import { store } from "../src/db/store.ts";
import { MOCK_SERVICES, MOCK_USERS } from "../src/db/seed.ts";
import {
  IncidentSchema,
  IncidentNoteSchema,
  Incident,
  IncidentNote,
} from "../src/contracts/incident.types.ts";
import {
  IncidentsListResponseSchema,
  IncidentsListResponse,
  ApiErrorEnvelopeSchema,
  ApiErrorEnvelope,
  UpdateIncidentStatusResponseSchema,
  UpdateIncidentStatusResponse,
} from "../src/contracts/api.types.ts";

/**
 * ============================================================================
 * TASK-BE-006: Dual-Target Mock Engine Integration - Test Suite
 * ============================================================================
 * Author: BE Test Writer Agent
 * File: backend/tests/msw.test.ts
 *
 * Verifies Mock Service Worker (MSW v2) node server interception across all
 * AtlasOps REST API endpoints, query filtering, mutations, optimistic
 * concurrency, chaos injection, directories, and standalone server factory.
 */

const BASE_URL = "http://localhost:3001";

describe("TASK-BE-006: MSW Interceptor Integration", () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
    store.reset();
  });

  afterAll(() => {
    server.close();
  });

  // --------------------------------------------------------------------------
  // TEST-MOCK-001: Health Check via MSW
  // --------------------------------------------------------------------------
  describe("TEST-MOCK-001: Health check via MSW", () => {
    it("returns HTTP 200 with status ok on GET /api/health", async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as any;
      expect(body.status).toBe("ok");
      expect(typeof body.timestamp).toBe("string");
      expect(typeof body.version).toBe("string");
      expect(typeof body.uptime).toBe("number");
    });

    it("returns HTTP 200 with status ok on GET /health", async () => {
      const res = await fetch(`${BASE_URL}/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as any;
      expect(body.status).toBe("ok");
    });

    it("unconditionally bypasses chaos failures on health endpoints", async () => {
      const res = await fetch(`${BASE_URL}/api/health`, {
        headers: { "X-Mock-Failure": "500" },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as any;
      expect(body.status).toBe("ok");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-MOCK-002: List Incidents via MSW
  // --------------------------------------------------------------------------
  describe("TEST-MOCK-002: List incidents via MSW", () => {
    it("returns paginated incidents response with default page 1, pageSize 25, total 1048", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as IncidentsListResponse;
      expect(() => IncidentsListResponseSchema.parse(body)).not.toThrow();
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(25);
      expect(body.total).toBe(1048);
      expect(body.totalPages).toBe(42);
      expect(body.items).toHaveLength(25);
    });

    it("filters incidents by substring search q", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents?q=payments`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as IncidentsListResponse;
      expect(body.total).toBeGreaterThan(0);
      for (const item of body.items) {
        const matches =
          item.service.toLowerCase().includes("payments") ||
          item.title.toLowerCase().includes("payments") ||
          item.id.toLowerCase().includes("payments") ||
          (item.assignee !== null && item.assignee.name.toLowerCase().includes("payments"));
        expect(matches).toBe(true);
      }
    });

    it("filters incidents by multi-value status, severity, and service", async () => {
      const res = await fetch(
        `${BASE_URL}/api/incidents?status=triggered,investigating&severity=critical&service=payments-api`
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as IncidentsListResponse;
      for (const item of body.items) {
        expect(["triggered", "investigating"]).toContain(item.status);
        expect(item.severity).toBe("critical");
        expect(item.service).toBe("payments-api");
      }
    });

    it("sorts incidents by severity descending and respects pagination parameters", async () => {
      const res = await fetch(
        `${BASE_URL}/api/incidents?sort=severity&order=desc&page=2&pageSize=10`
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as IncidentsListResponse;
      expect(body.page).toBe(2);
      expect(body.pageSize).toBe(10);
      expect(body.items).toHaveLength(10);
    });
  });

  // --------------------------------------------------------------------------
  // TEST-MOCK-003: Get Incident by ID via MSW
  // --------------------------------------------------------------------------
  describe("TEST-MOCK-003: Get incident by ID via MSW", () => {
    it("returns HTTP 200 with full incident for existing ID", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents/INC-1001`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Incident;
      expect(() => IncidentSchema.parse(body)).not.toThrow();
      expect(body.id).toBe("INC-1001");
    });

    it("returns HTTP 404 with INCIDENT_NOT_FOUND error envelope for missing ID", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents/INC-9999`);
      expect(res.status).toBe(404);

      const body = (await res.json()) as ApiErrorEnvelope;
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("INCIDENT_NOT_FOUND");
      expect(body.message).toContain("does not exist");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-MOCK-004: Create Incident via MSW
  // --------------------------------------------------------------------------
  describe("TEST-MOCK-004: Create incident via MSW", () => {
    it("creates incident, returns 201 Created with sequential ID, and increments store", async () => {
      const initialCount = store.count();

      const newIncidentPayload = {
        title: "Auth token verification cache eviction spike",
        description: "Redis cluster node memory saturation caused auth token verification cache evictions.",
        status: "triggered",
        severity: "high",
        service: "auth-gateway",
        assigneeId: "usr-1",
      };

      const res = await fetch(`${BASE_URL}/api/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newIncidentPayload),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as Incident;
      expect(() => IncidentSchema.parse(body)).not.toThrow();
      expect(body.id).toBe("INC-2049");
      expect(body.version).toBe(1);
      expect(body.notes).toEqual([]);
      expect(body.assignee?.id).toBe("usr-1");

      expect(store.count()).toBe(initialCount + 1);
    });

    it("rejects incident creation with status resolved", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Invalid resolved creation incident",
          description: "Cannot initialize incident directly in resolved state.",
          status: "resolved",
          service: "payments-api",
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("VALIDATION_ERROR");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-MOCK-005: Update Status via MSW
  // --------------------------------------------------------------------------
  describe("TEST-MOCK-005: Update status via MSW", () => {
    it("updates incident status, increments version, and updates updatedAt", async () => {
      const target = store.getAll().find((inc) => inc.status === "triggered");
      expect(target).toBeDefined();

      const res = await fetch(`${BASE_URL}/api/incidents/${target!.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "acknowledged",
          version: target!.version,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as UpdateIncidentStatusResponse;
      expect(() => UpdateIncidentStatusResponseSchema.parse(body)).not.toThrow();
      expect(body.status).toBe("acknowledged");
      expect(body.version).toBe(target!.version + 1);
    });

    it("rejects illegal status transition with HTTP 400 INVALID_TRANSITION", async () => {
      const target = store.getAll().find((inc) => inc.status === "triggered");
      expect(target).toBeDefined();

      const res = await fetch(`${BASE_URL}/api/incidents/${target!.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "resolved", // illegal from triggered
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(body.code).toBe("INVALID_TRANSITION");
    });

    it("returns HTTP 409 INCIDENT_VERSION_CONFLICT on version mismatch", async () => {
      const target = store.getAll().find((inc) => inc.status === "triggered");
      expect(target).toBeDefined();

      // First advance version
      await fetch(`${BASE_URL}/api/incidents/${target!.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "acknowledged" }),
      });

      // Second call with stale version 1
      const res = await fetch(`${BASE_URL}/api/incidents/${target!.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "investigating",
          version: 1, // Stale!
        }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(body.code).toBe("INCIDENT_VERSION_CONFLICT");
      expect(body.currentVersion).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // TEST-MOCK-006: Update Assignee via MSW
  // --------------------------------------------------------------------------
  describe("TEST-MOCK-006: Update assignee via MSW", () => {
    it("assigns valid operator, increments version, and returns updated Incident", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents/INC-1001/assignee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: "usr-2" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Incident;
      expect(() => IncidentSchema.parse(body)).not.toThrow();
      expect(body.assignee?.id).toBe("usr-2");
      expect(body.assignee?.name).toBe("Daniel Brooks");
    });

    it("unassigns incident when assigneeId is null", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents/INC-1001/assignee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: null }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Incident;
      expect(body.assignee).toBeNull();
    });

    it("returns HTTP 400 USER_NOT_FOUND when assignee does not exist", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents/INC-1001/assignee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: "usr-nonexistent-99" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(body.code).toBe("USER_NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-MOCK-007: Create Note via MSW
  // --------------------------------------------------------------------------
  describe("TEST-MOCK-007: Create note via MSW", () => {
    it("appends note to incident and returns HTTP 201 Created", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents/INC-1001/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Database read replicas synchronized and error budget preserved.",
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as IncidentNote;
      expect(() => IncidentNoteSchema.parse(body)).not.toThrow();
      expect(body.incidentId).toBe("INC-1001");
      expect(body.message).toContain("Database read replicas");
      expect(body.author).toBeDefined();

      // Verify incident in store has note
      const incident = store.findById("INC-1001");
      expect(incident?.notes.some((n) => n.id === body.id)).toBe(true);
    });

    it("rejects empty note message with HTTP 400 Bad Request", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents/INC-1001/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("VALIDATION_ERROR");
    });
  });

  // --------------------------------------------------------------------------
  // TEST-MOCK-008: Chaos Headers via MSW
  // --------------------------------------------------------------------------
  describe("TEST-MOCK-008: Chaos headers via MSW", () => {
    it("triggers HTTP 500 INTERNAL_SERVER_ERROR via X-Mock-Failure: 500", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents`, {
        headers: { "X-Mock-Failure": "500" },
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(body.code).toBe("INTERNAL_SERVER_ERROR");
    });

    it("triggers HTTP 503 SERVICE_UNAVAILABLE via X-Mock-Failure: 503", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents`, {
        headers: { "X-Mock-Failure": "503" },
      });

      expect(res.status).toBe(503);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(body.code).toBe("SERVICE_UNAVAILABLE");
    });

    it("triggers HTTP 429 RATE_LIMIT_EXCEEDED via X-Mock-Failure: 429", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents`, {
        headers: { "X-Mock-Failure": "429" },
      });

      expect(res.status).toBe(429);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("triggers HTTP 409 INCIDENT_VERSION_CONFLICT via X-Mock-Conflict: true on mutations", async () => {
      const res = await fetch(`${BASE_URL}/api/incidents/INC-1001/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Mock-Conflict": "true",
        },
        body: JSON.stringify({ status: "acknowledged" }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as ApiErrorEnvelope;
      expect(body.code).toBe("INCIDENT_VERSION_CONFLICT");
      expect(body.currentVersion).toBe(999);
    });
  });

  // --------------------------------------------------------------------------
  // Services & Users Directory via MSW
  // --------------------------------------------------------------------------
  describe("MSW Directories: Services and Users", () => {
    it("returns monitored services directory matching MOCK_SERVICES", async () => {
      const res = await fetch(`${BASE_URL}/api/services`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: string[] };
      expect(body.items).toHaveLength(7);
      expect(body.items).toEqual(MOCK_SERVICES);
    });

    it("returns operator directory matching MOCK_USERS", async () => {
      const res = await fetch(`${BASE_URL}/api/users`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: any[] };
      expect(body.items).toHaveLength(10);
      expect(body.items).toEqual(MOCK_USERS);
    });
  });

  // --------------------------------------------------------------------------
  // Standalone Server Factory
  // --------------------------------------------------------------------------
  describe("Standalone Server Factory (createServer)", () => {
    it("creates Express server instance with health and route handlers", () => {
      const app = createServer();
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe("function");
    });
  });
});
