import { Request, Response, Router } from "express";
import { incidentStore } from "../db/store.ts";

export const healthRouter = Router();

/**
 * Health check handler returning status, timestamp, version, uptime, and incident count.
 * Guaranteed to be exempt from latency and chaos simulation.
 */
export function handleHealthCheck(_req: Request, res: Response): void {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    uptime: process.uptime(),
    totalIncidents: incidentStore.count(),
  });
}

healthRouter.get("/", handleHealthCheck);
healthRouter.get("/health", handleHealthCheck);
healthRouter.get("/api/health", handleHealthCheck);
