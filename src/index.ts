import express from "express";
import cors from "cors";
import {
  MOCK_SERVICES,
  MOCK_USERS,
} from "./db/seed.ts";
import { incidentStore, store } from "./db/store.ts";
import {
  incidentsRouter,
  handleListIncidents,
  handleGetIncident,
  handleCreateIncident,
  handleUpdateStatus,
  handleUpdateAssignee,
  handleCreateNote,
} from "./routes/incidents.ts";
import { handleHealthCheck, healthRouter } from "./routes/health.ts";
import {
  createSimulationMiddleware,
  sleep,
  simulationMiddleware,
  type SimulationConfig,
} from "./middleware/simulation.ts";

function handleListServices(_req: express.Request, res: express.Response): void {
  res.json({ items: MOCK_SERVICES });
}

function handleListUsers(_req: express.Request, res: express.Response): void {
  res.json({ items: MOCK_USERS });
}

export {
  incidentStore,
  store,
  handleListIncidents,
  handleGetIncident,
  handleCreateIncident,
  handleUpdateStatus,
  handleUpdateAssignee,
  handleCreateNote,
  handleHealthCheck,
  handleListServices,
  handleListUsers,
  createSimulationMiddleware,
  sleep,
  simulationMiddleware,
  healthRouter,
  incidentsRouter,
};
export type { SimulationConfig };

export const app = express();

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
app.get("/api/services", handleListServices);
app.get("/api/users", handleListUsers);

// 4. Incidents domain router
app.use("/api/incidents", incidentsRouter);

const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
const PORT = Number(process.env.PORT) || (isTest ? 0 : 3001);

export const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AtlasOps backend listening on port ${PORT}`);
});
