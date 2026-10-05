import { describe, it, expect, beforeEach } from "vitest";
import http from "node:http";
import { Socket } from "node:net";
import express from "express";
import { app } from "../src/index.ts";
import {
  createSimulationMiddleware,
  sleep,
  SimulationConfig,
} from "../src/middleware/simulation.ts";
import { handleHealthCheck } from "../src/routes/health.ts";
import {
  ApiErrorEnvelopeSchema,
  ApiErrorEnvelope,
  MOCK_HEADERS,
} from "../src/contracts/api.types.ts";

/**
 * ============================================================================
 * TASK-BE-005: Latency & Chaos Failure Simulation - Test Suite
 * ============================================================================
 * Author: BE Test Writer Agent
 * File: backend/tests/simulation.test.ts
 *
 * Verifies:
 * - TEST-CHAOS-001: Health check endpoint fast response on /api/health and /health
 * - TEST-CHAOS-002: Zero-latency test bypass (TEST_MODE, NODE_ENV, VITEST, X-Test-Bypass)
 * - TEST-CHAOS-003: Configurable artificial latency (X-Mock-Delay, ?delay=<ms>)
 * - TEST-CHAOS-004: Chaos failure 500 (INTERNAL_SERVER_ERROR)
 * - TEST-CHAOS-005: Chaos failure 503 (SERVICE_UNAVAILABLE) & 504 (GATEWAY_TIMEOUT)
 * - TEST-CHAOS-006: Chaos failure 429 (RATE_LIMIT_EXCEEDED with Retry-After header)
 * - TEST-CHAOS-007: Chaos failure 400 (VALIDATION_ERROR) & 404 (INCIDENT_NOT_FOUND)
 * - TEST-CHAOS-008: Concurrency conflict injection (X-Mock-Conflict: true -> 409)
 *   and unconditional health check exemption from latency/chaos.
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

describe("TASK-BE-005: Sleep Utility & Delay Helper (sleep)", () => {
  it("TEST-SLEEP-001: pauses execution for approximately specified ms duration", async () => {
    const start = Date.now();
    await sleep(40);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(35);
  });

  it("TEST-SLEEP-002: resolves immediately when ms <= 0", async () => {
    const start = Date.now();
    await sleep(0);
    await sleep(-10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });
});

describe("TASK-BE-005: Simulation Middleware Unit Configuration (createSimulationMiddleware)", () => {
  it("TEST-SIM-UNIT-001: testMode: true immediately invokes next() with zero latency", async () => {
    const middleware = createSimulationMiddleware({ testMode: true });

    let called = false;
    const req: any = { headers: {}, url: "/api/incidents", method: "GET" };
    const res: any = {};
    const next = () => {
      called = true;
    };

    const start = Date.now();
    await middleware(req, res, next);
    const elapsed = Date.now() - start;

    expect(called).toBe(true);
    expect(elapsed).toBeLessThan(25);
  });

  it("TEST-SIM-UNIT-002: testMode: false honors X-Mock-Delay header", async () => {
    const middleware = createSimulationMiddleware({ testMode: false });

    let called = false;
    const req: any = {
      headers: { "x-mock-delay": "80" },
      url: "/api/incidents",
      method: "GET",
    };
    const res: any = {};
    const next = () => {
      called = true;
    };

    const start = Date.now();
    await middleware(req, res, next);
    const elapsed = Date.now() - start;

    expect(called).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(75);
  });

  it("TEST-SIM-UNIT-003: testMode: false honors ?delay=<ms> query parameter", async () => {
    const middleware = createSimulationMiddleware({ testMode: false });

    let called = false;
    const req: any = {
      headers: {},
      url: "/api/incidents?delay=60",
      query: { delay: "60" },
      method: "GET",
    };
    const res: any = {};
    const next = () => {
      called = true;
    };

    const start = Date.now();
    await middleware(req, res, next);
    const elapsed = Date.now() - start;

    expect(called).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(55);
  });

  it("TEST-SIM-UNIT-004: testMode: false is bypassed when X-Test-Bypass: true header is sent", async () => {
    const middleware = createSimulationMiddleware({ testMode: false });

    let called = false;
    const req: any = {
      headers: { "x-test-bypass": "true", "x-mock-delay": "500" },
      url: "/api/incidents",
      method: "GET",
    };
    const res: any = {};
    const next = () => {
      called = true;
    };

    const start = Date.now();
    await middleware(req, res, next);
    const elapsed = Date.now() - start;

    expect(called).toBe(true);
    expect(elapsed).toBeLessThan(30);
  });
});

describe("TASK-BE-005: Health Check Endpoints & Strict Exemption (TEST-CHAOS-001, TEST-CHAOS-008)", () => {
  it("TEST-CHAOS-001-A: GET /api/health returns HTTP 200 with status ok, uptime, version, timestamp", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/health");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.version).toBe("string");
    expect(typeof body.timestamp).toBe("string");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("TEST-CHAOS-001-B: GET /health returns HTTP 200 with status ok", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/health");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("TEST-CHAOS-008-A: health check is strictly exempt from chaos failure headers (X-Mock-Failure: 500)", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/health", undefined, {
      "X-Mock-Failure": "500",
    });

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("TEST-CHAOS-008-B: health check is strictly exempt from failure query params (?failure=503)", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/health?failure=503");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("TEST-CHAOS-008-C: health check is strictly exempt from artificial delay (X-Mock-Delay: 2000)", async () => {
    const start = Date.now();
    const { status, body } = await dispatchRequest(app, "GET", "/api/health", undefined, {
      "X-Mock-Delay": "2000",
    });
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(elapsed).toBeLessThan(35);
  });

  it("TEST-CHAOS-008-D: handleHealthCheck route handler directly sets status 200 with json payload", () => {
    let statusCode = 200;
    let jsonBody: any = null;

    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonBody = data;
        return this;
      },
    };

    handleHealthCheck({}, res);

    expect(statusCode).toBe(200);
    expect(jsonBody).toBeDefined();
    expect(jsonBody.status).toBe("ok");
  });
});

describe("TASK-BE-005: Automated Test Mode Bypass (TEST-CHAOS-002)", () => {
  it("TEST-CHAOS-002: normal API endpoints bypass artificial delay under test environment", async () => {
    const start = Date.now();
    const { status } = await dispatchRequest(app, "GET", "/api/incidents?pageSize=10");
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeLessThan(50);
  });

  it("TEST-CHAOS-002-B: X-Test-Bypass: true header guarantees 0ms latency bypass", async () => {
    const start = Date.now();
    const { status } = await dispatchRequest(app, "GET", "/api/incidents?pageSize=5", undefined, {
      "X-Test-Bypass": "true",
      "X-Mock-Delay": "500",
    });
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("TASK-BE-005: Configurable Artificial Latency (TEST-CHAOS-003)", () => {
  it("TEST-CHAOS-003-A: delays execution by specified ms when tested with non-bypassed simulation app", async () => {
    const delayApp = express();
    delayApp.use(createSimulationMiddleware({ testMode: false }));
    delayApp.get("/test-latency", (_req, res) => res.json({ ok: true }));

    const start = Date.now();
    const { status } = await dispatchRequest(delayApp, "GET", "/test-latency", undefined, {
      "X-Mock-Delay": "80",
    });
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(75);
  });

  it("TEST-CHAOS-003-B: delays execution via ?delay=<ms> query parameter", async () => {
    const delayApp = express();
    delayApp.use(createSimulationMiddleware({ testMode: false }));
    delayApp.get("/test-latency", (_req, res) => res.json({ ok: true }));

    const start = Date.now();
    const { status } = await dispatchRequest(delayApp, "GET", "/test-latency?delay=70");
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(65);
  });

  it("TEST-CHAOS-003-C: delays execution via ?__mock_delay=<ms> query parameter", async () => {
    const delayApp = express();
    delayApp.use(createSimulationMiddleware({ testMode: false }));
    delayApp.get("/test-latency", (_req, res) => res.json({ ok: true }));

    const start = Date.now();
    const { status } = await dispatchRequest(delayApp, "GET", "/test-latency?__mock_delay=60");
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(55);
  });
});

describe("TASK-BE-005: Chaos Failure 500 Simulation (TEST-CHAOS-004)", () => {
  it("TEST-CHAOS-004-A: X-Mock-Failure: 500 returns HTTP 500 with INTERNAL_SERVER_ERROR", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents", undefined, {
      "X-Mock-Failure": "500",
    });

    expect(status).toBe(500);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.message).toContain("Chaos simulation");
  });

  it("TEST-CHAOS-004-B: ?failure=500 query param returns HTTP 500 with ApiErrorEnvelope", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents?failure=500");

    expect(status).toBe(500);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("TEST-CHAOS-004-C: ?__mock_failure=500 query param returns HTTP 500 with ApiErrorEnvelope", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents?__mock_failure=500");

    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("TASK-BE-005: Chaos Failure 503 & 504 Simulation (TEST-CHAOS-005)", () => {
  it("TEST-CHAOS-005-A: X-Mock-Failure: 503 returns HTTP 503 with SERVICE_UNAVAILABLE", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents", undefined, {
      "X-Mock-Failure": "503",
    });

    expect(status).toBe(503);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.message).toContain("Chaos simulation");
  });

  it("TEST-CHAOS-005-B: ?failure=503 returns HTTP 503 with SERVICE_UNAVAILABLE", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents?failure=503");

    expect(status).toBe(503);
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("TEST-CHAOS-005-C: X-Mock-Failure: 504 returns HTTP 504 with GATEWAY_TIMEOUT", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents", undefined, {
      "X-Mock-Failure": "504",
    });

    expect(status).toBe(504);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("GATEWAY_TIMEOUT");
  });

  it("TEST-CHAOS-005-D: ?failure=504 returns HTTP 504 with GATEWAY_TIMEOUT", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents?failure=504");

    expect(status).toBe(504);
    expect(body.code).toBe("GATEWAY_TIMEOUT");
  });
});

describe("TASK-BE-005: Chaos Failure 429 Rate Limit Simulation (TEST-CHAOS-006)", () => {
  it("TEST-CHAOS-006-A: X-Mock-Failure: 429 returns HTTP 429 with RATE_LIMIT_EXCEEDED and Retry-After header", async () => {
    const { status, body, headers } = await dispatchRequest(
      app,
      "GET",
      "/api/incidents",
      undefined,
      {
        "X-Mock-Failure": "429",
      }
    );

    expect(status).toBe(429);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(headers).toHaveProperty("retry-after");
    expect(headers["retry-after"]).toBe("30");
  });

  it("TEST-CHAOS-006-B: ?failure=429 returns HTTP 429 with RATE_LIMIT_EXCEEDED", async () => {
    const { status, body, headers } = await dispatchRequest(
      app,
      "GET",
      "/api/incidents?failure=429"
    );

    expect(status).toBe(429);
    expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(headers["retry-after"]).toBe("30");
  });
});

describe("TASK-BE-005: Chaos Failure 400 & 404 Simulation (TEST-CHAOS-007)", () => {
  it("TEST-CHAOS-007-A: X-Mock-Failure: 400 returns HTTP 400 with VALIDATION_ERROR", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents", undefined, {
      "X-Mock-Failure": "400",
    });

    expect(status).toBe(400);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("TEST-CHAOS-007-B: ?failure=400 returns HTTP 400 with VALIDATION_ERROR", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents?failure=400");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("TEST-CHAOS-007-C: X-Mock-Failure: 404 returns HTTP 404 with INCIDENT_NOT_FOUND", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents", undefined, {
      "X-Mock-Failure": "404",
    });

    expect(status).toBe(404);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INCIDENT_NOT_FOUND");
  });

  it("TEST-CHAOS-007-D: ?failure=404 returns HTTP 404 with INCIDENT_NOT_FOUND", async () => {
    const { status, body } = await dispatchRequest(app, "GET", "/api/incidents?failure=404");

    expect(status).toBe(404);
    expect(body.code).toBe("INCIDENT_NOT_FOUND");
  });
});

describe("TASK-BE-005: Concurrency Conflict Injection (TEST-CHAOS-008)", () => {
  it("TEST-CHAOS-008-A: X-Mock-Conflict: true on PATCH mutation returns HTTP 409 INCIDENT_VERSION_CONFLICT", async () => {
    const { status, body } = await dispatchRequest(
      app,
      "PATCH",
      "/api/incidents/INC-1001/status",
      { status: "acknowledged" },
      { "X-Mock-Conflict": "true" }
    );

    expect(status).toBe(409);
    expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body.code).toBe("INCIDENT_VERSION_CONFLICT");
    expect(body.currentVersion).toBeDefined();
  });

  it("TEST-CHAOS-008-B: ?conflict=true query param on PATCH returns HTTP 409 Conflict", async () => {
    const { status, body } = await dispatchRequest(
      app,
      "PATCH",
      "/api/incidents/INC-1001/status?conflict=true",
      { status: "acknowledged" }
    );

    expect(status).toBe(409);
    expect(body.code).toBe("INCIDENT_VERSION_CONFLICT");
  });

  it("TEST-CHAOS-008-C: ?__mock_conflict=true query param on POST returns HTTP 409 Conflict", async () => {
    const { status, body } = await dispatchRequest(
      app,
      "POST",
      "/api/incidents?__mock_conflict=true",
      { title: "Test conflict", description: "Some description here", service: "payments-api" }
    );

    expect(status).toBe(409);
    expect(body.code).toBe("INCIDENT_VERSION_CONFLICT");
  });

  it("TEST-CHAOS-008-D: X-Mock-Conflict: true on GET does NOT trigger 409 Conflict (mutations only)", async () => {
    const { status } = await dispatchRequest(app, "GET", "/api/incidents", undefined, {
      "X-Mock-Conflict": "true",
    });

    // Should proceed normally to list incidents
    expect(status).toBe(200);
  });
});
