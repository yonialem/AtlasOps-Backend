import express from "express";
import cors from "cors";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    totalIncidents: 0,
  });
});

const PORT = Number(process.env.PORT) || 3001;

export const server = app.listen(PORT, () => {
  console.log(`AtlasOps backend listening on port ${PORT}`);
});
