import express from "express";
import cors from "cors";
import {
  generateSeedIncidents,
  MOCK_SERVICES,
  MOCK_USERS,
} from "./db/seed.ts";

export const app = express();

app.use(cors());
app.use(express.json());

export const seedIncidents = generateSeedIncidents();

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    totalIncidents: seedIncidents.length,
  });
});

app.get("/api/services", (_req, res) => {
  res.json({ items: MOCK_SERVICES });
});

app.get("/api/users", (_req, res) => {
  res.json({ items: MOCK_USERS });
});

app.get("/api/incidents", (_req, res) => {
  const pageSize = 25;
  const page = 1;
  const total = seedIncidents.length;
  const totalPages = Math.ceil(total / pageSize);
  res.json({
    items: seedIncidents.slice(0, pageSize),
    total,
    page,
    pageSize,
    totalPages,
  });
});

const PORT = Number(process.env.PORT) || 3001;

export const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AtlasOps backend listening on port ${PORT}`);
});
