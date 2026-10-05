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

export {
  incidentStore,
  store,
  handleListIncidents,
  handleGetIncident,
  handleCreateIncident,
  handleUpdateStatus,
  handleUpdateAssignee,
  handleCreateNote,
};

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    totalIncidents: incidentStore.count(),
  });
});

app.get("/api/services", (_req, res) => {
  res.json({ items: MOCK_SERVICES });
});

app.get("/api/users", (_req, res) => {
  res.json({ items: MOCK_USERS });
});

app.use("/api/incidents", incidentsRouter);

const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
const PORT = Number(process.env.PORT) || (isTest ? 0 : 3001);

export const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AtlasOps backend listening on port ${PORT}`);
});
