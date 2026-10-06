import { describe, it, expect } from "vitest";
import http from "node:http";
import { Socket } from "node:net";
import express from "express";
import { app } from "../src/index.ts";
import { createSimulationMiddleware, sleep } from "../src/middleware/simulation.ts";
import { ApiErrorEnvelopeSchema } from "../src/contracts/api.types.ts";

/**
 * ============================================================================
 * TASK-BE-007: Chaos & Latency Simulation Test Suite (TEST-BE-013 to TEST-BE-015)
 * ============================================================================
 * Author: BE Test Writer Agent
 * File: backend/tests/chaos.test.ts
 *
 * Verifies:
 * - TEST-BE-013: Chaos failure injection via headers (X-Mock-Failure: 500, X-Mock-Conflict: true)
 * - TEST-BE-014: Latency simulation and TEST_MODE=true bypass
 * - TEST-BE-015: GET /health and GET /api/health (200 OK, exempt from latency and chaos)
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

describe("TASK-BE-007: Chaos & Latency Simulation (TEST-BE-013 through TEST-BE-015)", () => {
  // --------------------------------------------------------------------------
  // TEST-BE-013: Chaos Failure & Conflict Injection
  // --------------------------------------------------------------------------
  describe("TEST-BE-013: Chaos Failure Injection via Headers", () => {
    it("returns HTTP 500 when X-Mock-Failure: 500 header is provided", async () => {
      const { status, body } = await dispatchRequest(app, "GET", "/api/incidents", undefined, {
        "X-Mock-Failure": "500",
      });

      expect(status).toBe(500);
      expect(() => ApiErrorEnvelopeSchema.parse(body)).not.toThrow();
      expect(["INTERNAL_SERVER_ERROR", "CHAOS_INJECTED_FAILURE"]).toContain(body.code);
    });

    it("returns HTTP 409 Conflict when X-Mock-Conflict: true is provided on mutation", async () => {
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
  });

  // --------------------------------------------------------------------------
  // TEST-BE-014: Latency Simulation & Test Mode Bypass
  // --------------------------------------------------------------------------
  describe("TEST-BE-014: Latency Simulation and TEST_MODE Bypass", () => {
    it("bypasses artificial latency (< 50ms) under automated test environment", async () => {
      const start = Date.now();
      const { status } = await dispatchRequest(app, "GET", "/api/incidents?pageSize=5");
      const elapsed = Date.now() - start;

      expect(status).toBe(200);
      expect(elapsed).toBeLessThan(50);
    });

    it("bypasses latency when X-Test-Bypass: true header is present", async () => {
      const start = Date.now();
      const { status } = await dispatchRequest(app, "GET", "/api/incidents?pageSize=5", undefined, {
        "X-Test-Bypass": "true",
        "X-Mock-Delay": "500",
      });
      const elapsed = Date.now() - start;

      expect(status).toBe(200);
      expect(elapsed).toBeLessThan(50);
    });

    it("injects artificial delay when test mode bypass is explicitly disabled", async () => {
      const testApp = express();
      testApp.use(createSimulationMiddleware({ testMode: false }));
      testApp.get("/test-delay", (_req, res) => res.json({ ok: true }));

      const start = Date.now();
      const { status } = await dispatchRequest(testApp, "GET", "/test-delay", undefined, {
        "X-Mock-Delay": "80",
      });
      const elapsed = Date.now() - start;

      expect(status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(75);
    });
  });

  // --------------------------------------------------------------------------
  // TEST-BE-015: Health Check & Strict Simulation Exemption
  // --------------------------------------------------------------------------
  describe("TEST-BE-015: Health Check Exemption", () => {
    it("GET /health returns HTTP 200 with status ok", async () => {
      const { status, body } = await dispatchRequest(app, "GET", "/health");

      expect(status).toBe(200);
      expect(body.status).toBe("ok");
    });

    it("GET /api/health returns HTTP 200 with status ok and uptime", async () => {
      const { status, body } = await dispatchRequest(app, "GET", "/api/health");

      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(typeof body.uptime).toBe("number");
    });

    it("GET /health is strictly exempt from chaos failure simulation", async () => {
      const { status, body } = await dispatchRequest(app, "GET", "/health", undefined, {
        "X-Mock-Failure": "500",
      });

      expect(status).toBe(200);
      expect(body.status).toBe("ok");
    });

    it("GET /api/health is strictly exempt from artificial delay", async () => {
      const start = Date.now();
      const { status, body } = await dispatchRequest(app, "GET", "/api/health", undefined, {
        "X-Mock-Delay": "2000",
      });
      const elapsed = Date.now() - start;

      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(elapsed).toBeLessThan(35);
    });
  });
});
