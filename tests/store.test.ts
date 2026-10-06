import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Readable, Writable } from "node:stream";
import {
  IncidentStore,
  store,
  sortIncidents,
} from "../src/db/store.ts";
import { app } from "../src/index.ts";
import {
  Incident,
  IncidentSchema,
  IncidentStatus,
  IncidentSeverity,
  SEVERITY_ORDER,
} from "../src/contracts/incident.types.ts";
import {
  IncidentsListResponseSchema,
  ApiErrorEnvelopeSchema,
  IncidentsListResponse,
  ApiErrorEnvelope,
  parseAndSanitizeQuery,
} from "../src/contracts/api.types.ts";

import http from "node:http";
import { Socket } from "node:net";

function dispatchRequest(
  expressApp: any,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
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
      resolve({ status: res.statusCode, body: parsed });
    });

    res.on("error", reject);

    expressApp(req, res, (err: any) => {
      if (err) reject(err);
      else resolve({ status: 404, body: { code: "NOT_FOUND", message: "Not Found" } });
    });

    if (bodyStr) {
      req.push(bodyStr);
    }
    req.push(null);
  });
}

/**
 * ============================================================================
 * TASK-BE-003: In-Memory Store & Query Engine - Test Suite
 * ============================================================================
 * Author: BE Test Writer Agent
 * File: backend/tests/store.test.ts
 *
 * Verifies in-memory store management, query filtering, multi-value OR within
 * dimension, multi-dimension AND intersection, multi-column sorting, clamped
 * pagination, findById, reset, and HTTP API endpoint integration.
 */

describe("TASK-BE-003: IncidentStore Class & Initialization", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-INST-001: exports singleton store instance of IncidentStore", () => {
    expect(store).toBeInstanceOf(IncidentStore);
  });

  it("TEST-STORE-INST-002: store.count() returns exactly 1,048 seeded incidents", () => {
    expect(store.count()).toBe(1048);
  });

  it("TEST-STORE-INST-003: store.getAll() returns shallow copy of all incidents without exposing internal array", () => {
    const all = store.getAll();
    expect(all).toHaveLength(1048);

    // Mutating returned array should not affect store.count()
    all.pop();
    expect(all).toHaveLength(1047);
    expect(store.count()).toBe(1048);
  });

  it("TEST-STORE-INST-004: IncidentStore can be constructed with custom initial dataset", () => {
    const customIncident: Incident = {
      id: "INC-9001",
      title: "Custom test incident for isolated store",
      description: "Custom test description exceeding twenty characters minimum.",
      status: "triggered",
      severity: "high",
      service: "payments-api",
      assignee: null,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:30:00.000Z",
      version: 1,
      notes: [],
    };

    const isolatedStore = new IncidentStore([customIncident]);
    expect(isolatedStore.count()).toBe(1);
    expect(isolatedStore.findById("INC-9001")).toEqual(customIncident);

    const emptyStore = new IncidentStore([]);
    expect(emptyStore.count()).toBe(0);
  });
});

describe("TASK-BE-003: Default Query Pagination (TEST-STORE-001)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-001: store.query() returns default paginated envelope (page 1, pageSize 25, total 1048, totalPages 42)", () => {
    const res = store.query();

    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(25);
    expect(res.total).toBe(1048);
    expect(res.totalPages).toBe(42);
    expect(res.items).toHaveLength(25);

    // Validates response schema contract
    expect(() => IncidentsListResponseSchema.parse(res)).not.toThrow();

    // Verify first page items satisfy IncidentSchema
    for (const item of res.items) {
      expect(() => IncidentSchema.parse(item)).not.toThrow();
    }
  });

  it("TEST-STORE-001-B: default sort is updatedAt descending", () => {
    const res = store.query();
    for (let i = 0; i < res.items.length - 1; i++) {
      const currentMs = new Date(res.items[i].updatedAt).getTime();
      const nextMs = new Date(res.items[i + 1].updatedAt).getTime();
      expect(currentMs).toBeGreaterThanOrEqual(nextMs);
    }
  });
});

describe("TASK-BE-003: Case-Insensitive Text Search `q` (TEST-STORE-002, TEST-STORE-003)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-002-A: matches substring on incident ID", () => {
    const res = store.query({ q: "INC-1001" });
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.items.some((inc) => inc.id === "INC-1001")).toBe(true);
  });

  it("TEST-STORE-002-B: matches substring on title case-insensitively", () => {
    const resLower = store.query({ q: "payment" });
    const resUpper = store.query({ q: "PAYMENT" });
    const resMixed = store.query({ q: "PaYmEnT" });

    expect(resLower.total).toBeGreaterThan(0);
    expect(resLower.total).toBe(resUpper.total);
    expect(resLower.total).toBe(resMixed.total);

    // Every item returned matches query in id, title, service, or assignee.name
    for (const item of resLower.items) {
      const q = "payment";
      const matchesId = item.id.toLowerCase().includes(q);
      const matchesTitle = item.title.toLowerCase().includes(q);
      const matchesService = item.service.toLowerCase().includes(q);
      const matchesAssignee = item.assignee !== null && item.assignee.name.toLowerCase().includes(q);

      expect(matchesId || matchesTitle || matchesService || matchesAssignee).toBe(true);
    }
  });

  it("TEST-STORE-002-C: matches substring on service", () => {
    const res = store.query({ q: "checkout-web", pageSize: 100 });
    expect(res.total).toBeGreaterThanOrEqual(100);
    for (const item of res.items) {
      const q = "checkout-web";
      const matches =
        item.service.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.assignee !== null && item.assignee.name.toLowerCase().includes(q));
      expect(matches).toBe(true);
    }
  });

  it("TEST-STORE-003: matches substring on assignee operator name", () => {
    const res = store.query({ q: "Maya" });
    expect(res.total).toBeGreaterThan(0);

    for (const item of res.items) {
      const q = "maya";
      const matches =
        (item.assignee !== null && item.assignee.name.toLowerCase().includes(q)) ||
        item.title.toLowerCase().includes(q) ||
        item.service.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q);
      expect(matches).toBe(true);
    }
  });

  it("TEST-STORE-002-D: handles unassigned incidents (assignee === null) safely without errors", () => {
    expect(() => store.query({ q: "Chen" })).not.toThrow();
  });

  it("TEST-STORE-002-E: returns empty items array and total 0 when no records match search", () => {
    const res = store.query({ q: "nonexistent-query-string-xyz-987654" });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(1);
    expect(res.page).toBe(1);
  });
});

describe("TASK-BE-003: Multi-Value Dimension Filtering (TEST-STORE-004, TEST-STORE-005, TEST-STORE-006)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-004: status multi-value filter (OR logic within status dimension)", () => {
    const res = store.query({ status: "triggered,investigating", pageSize: 100 });
    expect(res.total).toBeGreaterThan(0);

    for (const item of res.items) {
      expect(["triggered", "investigating"]).toContain(item.status);
      expect(item.status).not.toBe("acknowledged");
      expect(item.status).not.toBe("resolved");
    }

    // Verify union count equals sum of separate single-status queries
    const triggeredRes = store.query({ status: "triggered" });
    const investigatingRes = store.query({ status: "investigating" });
    expect(res.total).toBe(triggeredRes.total + investigatingRes.total);
  });

  it("TEST-STORE-005: severity multi-value filter (OR logic within severity dimension)", () => {
    const res = store.query({ severity: "critical,high", pageSize: 100 });
    expect(res.total).toBeGreaterThan(0);

    for (const item of res.items) {
      expect(["critical", "high"]).toContain(item.severity);
      expect(item.severity).not.toBe("medium");
      expect(item.severity).not.toBe("low");
    }

    const criticalRes = store.query({ severity: "critical" });
    const highRes = store.query({ severity: "high" });
    expect(res.total).toBe(criticalRes.total + highRes.total);
  });

  it("TEST-STORE-006: service multi-value filter (OR logic within service dimension)", () => {
    const res = store.query({ service: "payments-api,checkout-web", pageSize: 100 });
    expect(res.total).toBeGreaterThan(0);

    for (const item of res.items) {
      expect(["payments-api", "checkout-web"]).toContain(item.service);
    }

    const paymentsRes = store.query({ service: "payments-api" });
    const checkoutRes = store.query({ service: "checkout-web" });
    expect(res.total).toBe(paymentsRes.total + checkoutRes.total);
  });

  it("TEST-STORE-DIM-001: silently discards unrecognized filter tokens", () => {
    const validRes = store.query({ status: "triggered" });
    const mixedRes = store.query({ status: "triggered,bogus_status,another_invalid" });

    expect(mixedRes.total).toBe(validRes.total);
  });
});

describe("TASK-BE-003: Multi-Dimension Intersection (AND Across Dimensions) (TEST-STORE-007)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-007: intersects status, severity, and service filters simultaneously", () => {
    const res = store.query({
      status: "investigating",
      severity: "critical",
      service: "payments-api",
      pageSize: 100,
    });

    expect(res.total).toBeGreaterThan(0);

    for (const item of res.items) {
      expect(item.status).toBe("investigating");
      expect(item.severity).toBe("critical");
      expect(item.service).toBe("payments-api");
    }
  });

  it("TEST-STORE-007-B: intersects text search `q` with status and severity dimensions", () => {
    const res = store.query({
      q: "payments",
      status: "triggered",
      severity: "high",
      pageSize: 100,
    });

    for (const item of res.items) {
      expect(item.status).toBe("triggered");
      expect(item.severity).toBe("high");
      const matchesQ =
        item.service.toLowerCase().includes("payments") ||
        item.title.toLowerCase().includes("payments") ||
        item.id.toLowerCase().includes("payments") ||
        (item.assignee !== null && item.assignee.name.toLowerCase().includes("payments"));
      expect(matchesQ).toBe(true);
    }
  });

  it("TEST-STORE-007-C: returns empty result set when intersection yields zero matches", () => {
    // payments-api service incidents searching for inventory-specific keyword
    const res = store.query({
      service: "payments-api",
      q: "xyz_impossible_match_key_9999",
    });

    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(1);
  });
});

describe("TASK-BE-003: Multi-Column Sorting Pipeline (TEST-STORE-008, TEST-STORE-009)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-008-A: sorts by severity descending (critical > high > medium > low)", () => {
    const res = store.query({ sort: "severity", order: "desc", pageSize: 100 });

    for (let i = 0; i < res.items.length - 1; i++) {
      const currentRank = SEVERITY_ORDER[res.items[i].severity];
      const nextRank = SEVERITY_ORDER[res.items[i + 1].severity];
      expect(currentRank).toBeGreaterThanOrEqual(nextRank);
    }
  });

  it("TEST-STORE-008-B: sorts by severity ascending (low > medium > high > critical)", () => {
    const res = store.query({ sort: "severity", order: "asc", pageSize: 100 });

    for (let i = 0; i < res.items.length - 1; i++) {
      const currentRank = SEVERITY_ORDER[res.items[i].severity];
      const nextRank = SEVERITY_ORDER[res.items[i + 1].severity];
      expect(currentRank).toBeLessThanOrEqual(nextRank);
    }
  });

  it("TEST-STORE-008-C: tie-breaks equal severity with updatedAt desc, then id asc", () => {
    const res = store.query({ sort: "severity", order: "desc", pageSize: 100 });

    for (let i = 0; i < res.items.length - 1; i++) {
      if (res.items[i].severity === res.items[i + 1].severity) {
        const currentUpdated = new Date(res.items[i].updatedAt).getTime();
        const nextUpdated = new Date(res.items[i + 1].updatedAt).getTime();
        expect(currentUpdated).toBeGreaterThanOrEqual(nextUpdated);

        if (currentUpdated === nextUpdated) {
          expect(res.items[i].id.localeCompare(res.items[i + 1].id)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("TEST-STORE-009-A: sorts by createdAt ascending (oldest first)", () => {
    const res = store.query({ sort: "createdAt", order: "asc", pageSize: 50 });

    for (let i = 0; i < res.items.length - 1; i++) {
      const currentCreated = new Date(res.items[i].createdAt).getTime();
      const nextCreated = new Date(res.items[i + 1].createdAt).getTime();
      expect(currentCreated).toBeLessThanOrEqual(nextCreated);
    }
  });

  it("TEST-STORE-009-B: sorts by createdAt descending (newest first)", () => {
    const res = store.query({ sort: "createdAt", order: "desc", pageSize: 50 });

    for (let i = 0; i < res.items.length - 1; i++) {
      const currentCreated = new Date(res.items[i].createdAt).getTime();
      const nextCreated = new Date(res.items[i + 1].createdAt).getTime();
      expect(currentCreated).toBeGreaterThanOrEqual(nextCreated);
    }
  });

  it("TEST-STORE-009-C: sorts by updatedAt ascending (oldest updated first)", () => {
    const res = store.query({ sort: "updatedAt", order: "asc", pageSize: 50 });

    for (let i = 0; i < res.items.length - 1; i++) {
      const currentUpdated = new Date(res.items[i].updatedAt).getTime();
      const nextUpdated = new Date(res.items[i + 1].updatedAt).getTime();
      expect(currentUpdated).toBeLessThanOrEqual(nextUpdated);
    }
  });

  it("TEST-STORE-SORT-001: sortIncidents() is a pure function that does not mutate input array", () => {
    const raw = store.getAll().slice(0, 10);
    const originalIds = raw.map((r) => r.id);

    const sorted = sortIncidents(raw, "severity", "asc");

    expect(raw.map((r) => r.id)).toEqual(originalIds);
    expect(sorted).not.toBe(raw);
  });
});

describe("TASK-BE-003: Clamped Pagination & Window Boundary Slicing (TEST-STORE-010)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-010-A: clamps pageSize between 10 and 100", () => {
    // Values < 10 clamp to 10
    const resSmall = store.query({ pageSize: 5 });
    expect(resSmall.pageSize).toBe(10);
    expect(resSmall.items).toHaveLength(10);

    // Values > 100 clamp to 100
    const resLarge = store.query({ pageSize: 500 });
    expect(resLarge.pageSize).toBe(100);
    expect(resLarge.items).toHaveLength(100);

    // Allowed sizes 10, 25, 50, 100 respected
    const res50 = store.query({ pageSize: 50 });
    expect(res50.pageSize).toBe(50);
    expect(res50.items).toHaveLength(50);
  });

  it("TEST-STORE-010-B: clamps page < 1 to page 1", () => {
    const resZero = store.query({ page: 0 });
    expect(resZero.page).toBe(1);
    expect(resZero.items).toHaveLength(25);

    const resNegative = store.query({ page: -10 });
    expect(resNegative.page).toBe(1);
    expect(resNegative.items).toHaveLength(25);
  });

  it("TEST-STORE-010-C: pagination pages produce disjoint, contiguous slices", () => {
    const page1 = store.query({ page: 1, pageSize: 25 });
    const page2 = store.query({ page: 2, pageSize: 25 });

    expect(page1.items).toHaveLength(25);
    expect(page2.items).toHaveLength(25);

    const page1Ids = new Set(page1.items.map((i) => i.id));
    const page2Ids = new Set(page2.items.map((i) => i.id));

    // Zero overlap between page 1 and page 2
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
  });

  it("TEST-STORE-010-D: returns empty items when page is out of bounds (page > totalPages)", () => {
    const res = store.query({ page: 999 });

    expect(res.items).toEqual([]);
    expect(res.total).toBe(1048);
    expect(res.totalPages).toBe(42);
    expect(res.page).toBe(999);
  });

  it("TEST-STORE-010-E: totalPages is 1 when total is 0", () => {
    const res = store.query({ q: "nonexistent-query-unmatchable-xyz" });
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(1);
  });
});

describe("TASK-BE-003: Entity Lookup & Store Lifecycle (TEST-STORE-011, TEST-STORE-012, TEST-STORE-013)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-STORE-011: store.findById() returns exact incident entity when present", () => {
    const incident = store.findById("INC-1001");
    expect(incident).toBeDefined();
    expect(incident!.id).toBe("INC-1001");
    expect(() => IncidentSchema.parse(incident)).not.toThrow();
  });

  it("TEST-STORE-012: store.findById() returns undefined for non-existent incident ID", () => {
    const incident = store.findById("INC-9999");
    expect(incident).toBeUndefined();
  });

  it("TEST-STORE-013: store.reset() restores pristine 1,048 seed dataset after modifications", () => {
    const first = store.findById("INC-1001");
    expect(first).toBeDefined();
    const originalTitle = first!.title;

    // Mutate in-place
    first!.title = "Mutated Local Title";
    expect(store.findById("INC-1001")!.title).toBe("Mutated Local Title");

    // Reset store
    store.reset();
    expect(store.count()).toBe(1048);
    expect(store.findById("INC-1001")!.title).toBe(originalTitle);
  });

  it("TEST-STORE-RESET-002: store.reset() supports optional custom seed", () => {
    store.reset(12345);
    expect(store.count()).toBe(1048);
    const customFirst = store.findById("INC-1001");
    expect(customFirst).toBeDefined();

    store.reset(); // default seed
    const defaultFirst = store.findById("INC-1001");
    expect(defaultFirst).toBeDefined();
  });
});

describe("TASK-BE-003: HTTP Route Integration (TEST-STORE-014)", () => {
  it("TEST-STORE-014-A: GET /api/incidents returns HTTP 200 with IncidentsListResponse", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents");
    expect(status).toBe(200);

    expect(() => IncidentsListResponseSchema.parse(body)).not.toThrow();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(body.total).toBe(1048);
    expect(body.totalPages).toBe(42);
    expect(body.items).toHaveLength(25);
  });

  it("TEST-STORE-014-B: GET /api/incidents forwards query parameters (status, severity, pageSize)", async () => {
    const { status, body } = await dispatchRequest(
      app,
      "GET",
      "/api/incidents?status=triggered&severity=critical&pageSize=10"
    );
    expect(status).toBe(200);

    expect(body.pageSize).toBe(10);
    expect(body.items.length).toBeLessThanOrEqual(10);

    for (const item of body.items) {
      expect(item.status).toBe("triggered");
      expect(item.severity).toBe("critical");
    }
  });

  it("TEST-STORE-014-C: GET /api/incidents/:id returns HTTP 200 with Incident for existing record", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents/INC-1001");
    expect(status).toBe(200);

    expect(() => IncidentSchema.parse(body)).not.toThrow();
    expect(body.id).toBe("INC-1001");
  });

  it("TEST-STORE-014: GET /api/incidents/:id returns HTTP 404 with ApiErrorEnvelope on missing ID", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents/INC-9999");
    expect(status).toBe(404);

    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INCIDENT_NOT_FOUND");
    expect(body.message).toBe("The requested incident does not exist.");
  });
});

describe("TASK-BE-007: IncidentStore Query Engine Contract Matrix (TEST-BE-001 through TEST-BE-006)", () => {
  beforeEach(() => {
    store.reset();
  });

  it("TEST-BE-001: multi-field search q matches across id, title, service, and assignee name", () => {
    // Search by service substring
    const resPayments = store.query({ q: "payments" });
    expect(resPayments.total).toBeGreaterThan(0);
    for (const item of resPayments.items) {
      const match =
        item.service.toLowerCase().includes("payments") ||
        item.title.toLowerCase().includes("payments") ||
        item.id.toLowerCase().includes("payments") ||
        (item.assignee !== null && item.assignee.name.toLowerCase().includes("payments"));
      expect(match).toBe(true);
    }

    // Search by assignee name substring
    const resMaya = store.query({ q: "Maya" });
    expect(resMaya.total).toBeGreaterThan(0);
    for (const item of resMaya.items) {
      const match =
        (item.assignee !== null && item.assignee.name.toLowerCase().includes("maya")) ||
        item.title.toLowerCase().includes("maya") ||
        item.service.toLowerCase().includes("maya") ||
        item.id.toLowerCase().includes("maya");
      expect(match).toBe(true);
    }
  });

  it("TEST-BE-002: comma-separated multi-value status and severity filtering (OR logic)", () => {
    const resStatus = store.query({ status: "triggered,investigating", pageSize: 50 });
    expect(resStatus.total).toBeGreaterThan(0);
    for (const item of resStatus.items) {
      expect(["triggered", "investigating"]).toContain(item.status);
    }

    const resSeverity = store.query({ severity: "critical,high", pageSize: 50 });
    expect(resSeverity.total).toBeGreaterThan(0);
    for (const item of resSeverity.items) {
      expect(["critical", "high"]).toContain(item.severity);
    }
  });

  it("TEST-BE-003: service filtering and cross-dimension logical AND intersection", () => {
    const res = store.query({
      service: "payments-api,checkout-web",
      severity: "critical",
      pageSize: 50,
    });

    expect(res.total).toBeGreaterThan(0);
    for (const item of res.items) {
      expect(["payments-api", "checkout-web"]).toContain(item.service);
      expect(item.severity).toBe("critical");
    }
  });

  it("TEST-BE-004: severity ranking sorting (critical>high>medium>low) with direction and tie-breakers", () => {
    // Descending severity sort
    const resDesc = store.query({ sort: "severity", order: "desc", pageSize: 50 });
    for (let i = 0; i < resDesc.items.length - 1; i++) {
      const curr = SEVERITY_ORDER[resDesc.items[i].severity];
      const next = SEVERITY_ORDER[resDesc.items[i + 1].severity];
      expect(curr).toBeGreaterThanOrEqual(next);
      if (curr === next) {
        const currUpdated = new Date(resDesc.items[i].updatedAt).getTime();
        const nextUpdated = new Date(resDesc.items[i + 1].updatedAt).getTime();
        expect(currUpdated).toBeGreaterThanOrEqual(nextUpdated);
      }
    }

    // Ascending severity sort
    const resAsc = store.query({ sort: "severity", order: "asc", pageSize: 50 });
    for (let i = 0; i < resAsc.items.length - 1; i++) {
      const curr = SEVERITY_ORDER[resAsc.items[i].severity];
      const next = SEVERITY_ORDER[resAsc.items[i + 1].severity];
      expect(curr).toBeLessThanOrEqual(next);
    }
  });

  it("TEST-BE-005: date sorting order (createdAt, updatedAt) ascending and descending", () => {
    // CreatedAt ascending
    const resCreatedAsc = store.query({ sort: "createdAt", order: "asc", pageSize: 50 });
    for (let i = 0; i < resCreatedAsc.items.length - 1; i++) {
      const curr = new Date(resCreatedAsc.items[i].createdAt).getTime();
      const next = new Date(resCreatedAsc.items[i + 1].createdAt).getTime();
      expect(curr).toBeLessThanOrEqual(next);
    }

    // UpdatedAt descending
    const resUpdatedDesc = store.query({ sort: "updatedAt", order: "desc", pageSize: 50 });
    for (let i = 0; i < resUpdatedDesc.items.length - 1; i++) {
      const curr = new Date(resUpdatedDesc.items[i].updatedAt).getTime();
      const next = new Date(resUpdatedDesc.items[i + 1].updatedAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(next);
    }
  });

  it("TEST-BE-006: clamped pagination boundaries (page < 1, page > totalPages, pageSize bounds 1-100)", () => {
    // Page < 1 clamps to 1
    const resNegativePage = store.query({ page: -1 });
    expect(resNegativePage.page).toBe(1);
    expect(resNegativePage.items).toHaveLength(25);

    // Page > totalPages returns empty items
    const resOutOfBounds = store.query({ page: 999 });
    expect(resOutOfBounds.items).toEqual([]);
    expect(resOutOfBounds.total).toBe(1048);
    expect(resOutOfBounds.totalPages).toBe(42);

    // PageSize bounds
    const res50 = store.query({ pageSize: 50 });
    expect(res50.pageSize).toBe(50);
    expect(res50.items).toHaveLength(50);

    const res999 = store.query({ pageSize: 999 });
    expect(res999.pageSize).toBe(100);
    expect(res999.items).toHaveLength(100);
  });
});

