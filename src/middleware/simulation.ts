import { Request, Response, NextFunction } from "express";
import { API_ERROR_CODES, ApiErrorEnvelope } from "../contracts/api.types.ts";

export interface SimulationConfig {
  defaultMinDelayMs?: number; // default: 200
  defaultMaxDelayMs?: number; // default: 1200
  minDelay?: number;
  maxDelay?: number;
  testMode?: boolean;
}

/**
 * Utility helper to sleep for a specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to extract a parameter value from either request headers or query string.
 */
function extractParam(
  req: Request,
  headerName: string,
  queryKeys: string[]
): string | undefined {
  // 1. Try Express req.get() if available
  if (typeof (req as any).get === "function") {
    const val = (req as any).get(headerName);
    if (val !== undefined && val !== null) {
      const str = Array.isArray(val) ? val[0] : String(val);
      if (str.trim() !== "") return str.trim();
    }
  }

  // 2. Fall back to case-insensitive header lookup on req.headers
  if (req.headers) {
    const targetKey = headerName.toLowerCase();
    let headerVal = req.headers[targetKey] ?? (req.headers as any)[headerName];

    if (headerVal === undefined || headerVal === null) {
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() === targetKey) {
          headerVal = value;
          break;
        }
      }
    }

    if (headerVal !== undefined && headerVal !== null) {
      const str = Array.isArray(headerVal) ? headerVal[0] : String(headerVal);
      if (str.trim() !== "") return str.trim();
    }
  }

  // 3. Query string lookup (with case-insensitive fallback)
  const query = (req && req.query) || {};
  for (const key of queryKeys) {
    let queryVal = query[key];
    if (queryVal === undefined || queryVal === null) {
      const targetQueryKey = key.toLowerCase();
      for (const [qKey, qValue] of Object.entries(query)) {
        if (qKey.toLowerCase() === targetQueryKey) {
          queryVal = qValue;
          break;
        }
      }
    }
    if (queryVal !== undefined && queryVal !== null) {
      const str = Array.isArray(queryVal) ? String(queryVal[0]) : String(queryVal);
      if (str.trim() !== "") return str.trim();
    }
  }

  return undefined;
}

/**
 * Returns Express compatible middleware injecting artificial latency and chaos failures.
 */
export function createSimulationMiddleware(config: SimulationConfig = {}) {
  const minDelayMs = config.defaultMinDelayMs ?? config.minDelay ?? 200;
  const maxDelayMs = config.defaultMaxDelayMs ?? config.maxDelay ?? 1200;

  return async function simulationMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    // 1. Health Route Check: Always bypass latency & chaos simulation
    const path = req.path || "";
    const originalUrl = req.originalUrl || req.url || "";
    const isHealthRoute =
      path === "/health" ||
      path === "/api/health" ||
      path.endsWith("/health") ||
      originalUrl === "/health" ||
      originalUrl === "/api/health" ||
      originalUrl.startsWith("/health?") ||
      originalUrl.startsWith("/api/health?");

    if (isHealthRoute) {
      return next();
    }

    // 2. Latency Simulation
    const rawDelay = extractParam(req, "x-mock-delay", [
      "delay",
      "__mock_delay",
      "mock_delay",
      "x-mock-delay",
    ]);

    let explicitDelayMs: number | undefined;
    if (rawDelay !== undefined) {
      const parsed = parseInt(rawDelay, 10);
      if (!isNaN(parsed)) {
        explicitDelayMs = Math.max(0, parsed);
      }
    }

    const testBypassParam = extractParam(req, "x-test-bypass", [
      "test_bypass",
      "__test_bypass",
      "x-test-bypass",
    ]);
    const hasExplicitBypassHeader = testBypassParam?.toLowerCase() === "true";
    const hasExplicitNoBypassHeader = testBypassParam?.toLowerCase() === "false";

    const envTestMode = process.env.TEST_MODE;
    const isEnvTestModeTrue = envTestMode === "true";
    const isEnvTestModeFalse = envTestMode === "false";

    const isTestEnv =
      Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

    let delayMs = 0;

    const hasBypassRequested =
      hasExplicitBypassHeader ||
      config.testMode === true ||
      isEnvTestModeTrue;

    const hasNoBypassRequested =
      hasExplicitNoBypassHeader ||
      config.testMode === false ||
      isEnvTestModeFalse;

    if (hasBypassRequested) {
      delayMs = 0;
    } else if (explicitDelayMs !== undefined) {
      delayMs = explicitDelayMs;
    } else if (hasNoBypassRequested) {
      delayMs =
        Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
    } else if (isTestEnv) {
      delayMs = 0;
    } else {
      delayMs =
        Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    // 3. Chaos Failure Evaluation
    const rawFailure = extractParam(req, "x-mock-failure", [
      "failure",
      "__mock_failure",
      "mock_failure",
      "x-mock-failure",
    ]);
    const failure = rawFailure?.toLowerCase();

    const rawConflict = extractParam(req, "x-mock-conflict", [
      "conflict",
      "__mock_conflict",
      "mock_conflict",
      "x-mock-conflict",
    ]);
    const isConflictRequested =
      rawConflict?.toLowerCase() === "true" || rawConflict === "1";

    // Concurrency conflict simulation: only applies to mutation operations
    const isMutationMethod = ["POST", "PATCH", "PUT", "DELETE"].includes(
      req.method.toUpperCase()
    );

    if (isConflictRequested && isMutationMethod) {
      const conflictPayload: ApiErrorEnvelope & {
        error: { code: string; message: string; currentVersion: number };
      } = {
        code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
        message: "Chaos simulation: simulated concurrency conflict.",
        currentVersion: 999,
        error: {
          code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
          message: "Chaos simulation: simulated concurrency conflict.",
          currentVersion: 999,
        },
      };
      res.status(409).json(conflictPayload);
      return;
    }

    if (failure) {
      if (failure === "500" || failure === "internal_server_error" || failure === "true") {
        const payload = {
          code: API_ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: "Chaos simulation: simulated internal server error.",
          error: {
            code: API_ERROR_CODES.INTERNAL_SERVER_ERROR,
            message: "Chaos simulation: simulated internal server error.",
          },
        };
        res.status(500).json(payload);
        return;
      }

      if (failure === "503" || failure === "service_unavailable") {
        const payload = {
          code: "SERVICE_UNAVAILABLE",
          message: "Chaos simulation: simulated service outage.",
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Chaos simulation: simulated service outage.",
          },
        };
        res.status(503).json(payload);
        return;
      }

      if (failure === "504" || failure === "gateway_timeout") {
        const payload = {
          code: "GATEWAY_TIMEOUT",
          message: "Chaos simulation: simulated gateway timeout.",
          error: {
            code: "GATEWAY_TIMEOUT",
            message: "Chaos simulation: simulated gateway timeout.",
          },
        };
        res.status(504).json(payload);
        return;
      }

      if (failure === "429" || failure === "rate_limit_exceeded") {
        res.setHeader("Retry-After", "30");
        const payload = {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Chaos simulation: rate limit exceeded. Retry after 30s.",
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Chaos simulation: rate limit exceeded. Retry after 30s.",
          },
        };
        res.status(429).json(payload);
        return;
      }

      if (failure === "400" || failure === "validation_error") {
        const payload = {
          code: API_ERROR_CODES.VALIDATION_ERROR,
          message: "Chaos simulation: simulated bad request.",
          error: {
            code: API_ERROR_CODES.VALIDATION_ERROR,
            message: "Chaos simulation: simulated bad request.",
          },
        };
        res.status(400).json(payload);
        return;
      }

      if (failure === "404" || failure === "incident_not_found" || failure === "not_found") {
        const payload = {
          code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
          message: "Chaos simulation: simulated resource not found.",
          error: {
            code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
            message: "Chaos simulation: simulated resource not found.",
          },
        };
        res.status(404).json(payload);
        return;
      }

      if (failure === "409" || failure === "incident_version_conflict" || failure === "conflict") {
        const payload = {
          code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
          message: "Chaos simulation: simulated concurrency conflict.",
          currentVersion: 999,
          error: {
            code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
            message: "Chaos simulation: simulated concurrency conflict.",
            currentVersion: 999,
          },
        };
        res.status(409).json(payload);
        return;
      }

      if (failure === "timeout") {
        await sleep(15000);
        if (!res.headersSent) {
          res.status(504).json({
            code: "GATEWAY_TIMEOUT",
            message: "Chaos simulation: simulated gateway timeout.",
            error: {
              code: "GATEWAY_TIMEOUT",
              message: "Chaos simulation: simulated gateway timeout.",
            },
          });
        }
        return;
      }

      if (failure === "network-error" || failure === "network_error") {
        if (req.socket && !req.socket.destroyed) {
          req.socket.destroy();
        }
        return;
      }
    }

    // No simulation failure triggered; proceed to next handler
    return next();
  };
}

export const simulationMiddleware = createSimulationMiddleware();
