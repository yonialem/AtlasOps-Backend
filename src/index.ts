import express from "express";
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
import { createServer, startServer } from "./server.ts";
import { handlers } from "./msw/handlers.ts";
import { server as mswServer } from "./msw/node.ts";

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
  createServer,
  startServer,
  handlers,
  mswServer,
};
export type { SimulationConfig };

export const app = createServer();

const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
const PORT = Number(process.env.PORT) || (isTest ? 0 : 3001);

export const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AtlasOps backend listening on port ${PORT}`);
});
