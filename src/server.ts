import express from "express";
import cors from "cors";
import { createSimulationMiddleware } from "./middleware/simulation.ts";
import { store, incidentStore } from "./db/store.ts";
import { MOCK_SERVICES, MOCK_USERS } from "./db/seed.ts";
import { incidentsRouter } from "./routes/incidents.ts";
import { handleHealthCheck, healthRouter } from "./routes/health.ts";

/**
 * Creates and configures the Express application with CORS, JSON parsing,
 * exempt health check routes, latency/chaos simulation, and API routers.
 */
export function createServer(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // 1. Health check endpoints: mounted BEFORE simulation middleware for zero-overhead exemption
  app.get("/health", handleHealthCheck);
  app.get("/api/health", handleHealthCheck);
  app.use("/health", healthRouter);
  app.use("/api/health", healthRouter);

  // 2. Simulation middleware for artificial latency & chaos failure injection
  app.use(createSimulationMiddleware());

  // 3. Metadata catalogue endpoints
  app.get("/api/services", (_req, res) => {
    res.json({ items: MOCK_SERVICES });
  });
  app.get("/api/users", (_req, res) => {
    res.json({ items: MOCK_USERS });
  });

  // 4. Incidents domain router
  app.use("/api/incidents", incidentsRouter);

  return app;
}

/**
 * Starts the standalone Express server on the specified port.
 */
export function startServer(port: number = 3001) {
  const app = createServer();
  return app.listen(port, "0.0.0.0", () => {
    console.log(`[AtlasOps Backend] Standalone server listening on http://localhost:${port}`);
  });
}

// Auto-run if executed directly
const isMain =
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js");

if (isMain) {
  const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  const PORT = Number(process.env.PORT) || (isTest ? 0 : 3001);
  startServer(PORT);
}
