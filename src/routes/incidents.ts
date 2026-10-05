import { Request, Response, Router } from "express";
import { z } from "zod";
import {
  IncidentCreateInputSchema,
  IncidentStatusUpdateInputSchema,
  IncidentAssigneeUpdateInputSchema,
  IncidentNoteCreateInputSchema,
} from "../contracts/incident.types.ts";
import { incidentStore, StoreError } from "../db/store.ts";
import { MOCK_USERS } from "../db/seed.ts";

export const incidentsRouter = Router();

/**
 * GET /api/incidents
 * Query, search, filter, sort, and paginate incidents.
 */
export function handleListIncidents(req: Request, res: Response): void {
  const result = incidentStore.query(req.query as any);
  res.json(result);
}

/**
 * GET /api/incidents/:id
 * Retrieve single incident by ID.
 */
export function handleGetIncident(req: Request, res: Response): void {
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
}

/**
 * POST /api/incidents
 * Create a new incident. Initial status 'resolved' is strictly disallowed.
 */
export function handleCreateIncident(req: Request, res: Response): void {
  // Reject initial status === "resolved" explicitly
  if (req.body?.status === "resolved") {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Incident cannot be created directly in resolved status.",
      fieldErrors: {
        status: ["Incident cannot be created directly in resolved status."],
      },
    });
    return;
  }

  const parsed = IncidentCreateInputSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "The submitted incident is invalid.",
      fieldErrors,
    });
    return;
  }

  if (parsed.data.assigneeId && !MOCK_USERS.some((u) => u.id === parsed.data.assigneeId)) {
    res.status(400).json({
      code: "USER_NOT_FOUND",
      message: "The specified assignee does not exist.",
    });
    return;
  }

  const created = incidentStore.create(parsed.data);
  res.status(201).json(created);
}

/**
 * PATCH /api/incidents/:id/status
 * Transition incident status with state-machine & optimistic concurrency validation.
 */
export function handleUpdateStatus(req: Request, res: Response): void {
  const { id } = req.params;

  const StatusSchema = IncidentStatusUpdateInputSchema.extend({
    version: z.number().int().min(0).optional(),
  });

  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString() || "status";
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Invalid status update payload.",
      fieldErrors,
    });
    return;
  }

  try {
    const result = incidentStore.updateStatus(id, parsed.data);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof StoreError) {
      if (err.code === "NOT_FOUND") {
        res.status(404).json({
          code: "INCIDENT_NOT_FOUND",
          message: err.message,
        });
        return;
      }
      if (err.code === "CONFLICT") {
        res.status(409).json({
          code: "INCIDENT_VERSION_CONFLICT",
          message: err.message,
          currentVersion: err.currentVersion,
        });
        return;
      }
      if (err.code === "INVALID_TRANSITION") {
        res.status(400).json({
          code: "INVALID_TRANSITION",
          message: err.message,
        });
        return;
      }
    }
    res.status(500).json({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error during status update.",
    });
  }
}

/**
 * PATCH /api/incidents/:id/assignee
 * Assign, reassign, or unassign incident responder.
 */
export function handleUpdateAssignee(req: Request, res: Response): void {
  const { id } = req.params;

  const AssigneeSchema = IncidentAssigneeUpdateInputSchema.extend({
    version: z.number().int().min(0).optional(),
  });

  const parsed = AssigneeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Invalid assignee payload.",
    });
    return;
  }

  try {
    const incident = incidentStore.updateAssignee(id, parsed.data);
    res.status(200).json(incident);
  } catch (err) {
    if (err instanceof StoreError) {
      if (err.code === "NOT_FOUND") {
        res.status(404).json({
          code: "INCIDENT_NOT_FOUND",
          message: err.message,
        });
        return;
      }
      if (err.code === "CONFLICT") {
        res.status(409).json({
          code: "INCIDENT_VERSION_CONFLICT",
          message: err.message,
          currentVersion: err.currentVersion,
        });
        return;
      }
      if (err.code === "USER_NOT_FOUND") {
        res.status(400).json({
          code: "USER_NOT_FOUND",
          message: err.message,
        });
        return;
      }
    }
    res.status(500).json({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error during assignee update.",
    });
  }
}

/**
 * POST /api/incidents/:id/notes
 * Append an investigation note to an existing incident.
 */
export function handleCreateNote(req: Request, res: Response): void {
  const { id } = req.params;

  const rawMessage = req.body?.message;
  if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Investigation note cannot be empty or whitespace-only.",
      fieldErrors: {
        message: ["Note message cannot be empty or whitespace-only."],
      },
    });
    return;
  }

  const parsed = IncidentNoteCreateInputSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString() || "message";
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Investigation note cannot be empty or whitespace-only.",
      fieldErrors,
    });
    return;
  }

  try {
    const note = incidentStore.createNote(id, {
      ...parsed.data,
      authorId: req.body?.authorId,
    });
    res.status(201).json(note);
  } catch (err) {
    if (err instanceof StoreError && err.code === "NOT_FOUND") {
      res.status(404).json({
        code: "INCIDENT_NOT_FOUND",
        message: err.message,
      });
      return;
    }
    res.status(500).json({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error during note creation.",
    });
  }
}

// Router registration
incidentsRouter.get("/", handleListIncidents);
incidentsRouter.post("/", handleCreateIncident);
incidentsRouter.get("/:id", handleGetIncident);
incidentsRouter.patch("/:id/status", handleUpdateStatus);
incidentsRouter.patch("/:id/assignee", handleUpdateAssignee);
incidentsRouter.post("/:id/notes", handleCreateNote);
