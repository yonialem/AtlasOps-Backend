import express from "express";
import cors from "cors";
import {
  MOCK_SERVICES,
  MOCK_USERS,
} from "./db/seed.ts";
import { incidentStore, store } from "./db/store.ts";

export { incidentStore, store };

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

app.get("/api/incidents", (req, res) => {
  const response = incidentStore.query(req.query as any);
  res.json(response);
});

app.get("/api/incidents/:id", (req, res) => {
  const { id } = req.params;
  const incident = incidentStore.findById(id);
  if (!incident) {
    res.status(404).json({
      code: "INCIDENT_NOT_FOUND",
      message: "The requested incident does not exist.",
    });
    return;
  }
  res.json(incident);
});

const PORT = Number(process.env.PORT) || 3001;

export const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AtlasOps backend listening on port ${PORT}`);
});
