import { z } from "zod";

/**
 * ============================================================================
 * AtlasOps Incident Management Console - Domain Data Contracts
 * ============================================================================
 * File: contracts/incident.types.ts
 * Single Source of Truth for Incident, Note, User, and Mutation Entities.
 */

// ----------------------------------------------------------------------------
// 1. Primitive Enums & Literals
// ----------------------------------------------------------------------------

export const INCIDENT_STATUSES = [
  "triggered",
  "acknowledged",
  "investigating",
  "resolved",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const IncidentStatusSchema = z.enum(INCIDENT_STATUSES, {
  errorMap: () => ({ message: "Status must be one of: triggered, acknowledged, investigating, resolved." }),
});

export const INCIDENT_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const IncidentSeveritySchema = z.enum(INCIDENT_SEVERITIES, {
  errorMap: () => ({ message: "Severity must be one of: critical, high, medium, low." }),
});

/**
 * Severity ranking weights for sorting: critical (4) > high (3) > medium (2) > low (1).
 */
export const SEVERITY_ORDER: Record<IncidentSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
} as const;

export function compareSeverity(a: IncidentSeverity, b: IncidentSeverity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}

// ----------------------------------------------------------------------------
// 2. Lifecycle State Machine Transitions
// ----------------------------------------------------------------------------

/**
 * Authoritative lifecycle state transition matrix.
 * Disallows illegal transitions (e.g., triggered -> resolved is strictly blocked).
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  triggered: ["acknowledged", "investigating"],
  acknowledged: ["investigating", "resolved"],
  investigating: ["resolved", "acknowledged"],
  resolved: ["investigating"],
} as const;

export function isValidStatusTransition(
  current: IncidentStatus,
  target: IncidentStatus
): boolean {
  if (current === target) return true;
  return ALLOWED_STATUS_TRANSITIONS[current]?.includes(target) ?? false;
}

// ----------------------------------------------------------------------------
// 3. User & Attribution Structures
// ----------------------------------------------------------------------------

export const UserSummarySchema = z.object({
  id: z.string().min(1, "User ID cannot be empty."),
  name: z.string().min(1, "User name cannot be empty."),
  email: z.string().email("Invalid user email address."),
  avatarUrl: z.string().url("Invalid avatar URL.").optional(),
});

export type UserSummary = z.infer<typeof UserSummarySchema>;

// ----------------------------------------------------------------------------
// 4. Investigation Note Entity
// ----------------------------------------------------------------------------

export const IncidentNoteSchema = z.object({
  id: z.string().min(1, "Note ID cannot be empty."),
  incidentId: z.string().regex(/^INC-\d+$/, "Incident ID must match pattern INC-<number>."),
  author: UserSummarySchema,
  message: z
    .string()
    .min(1, "Note message cannot be empty.")
    .max(5000, "Note message cannot exceed 5000 characters.")
    .refine((val) => val.trim().length > 0, {
      message: "Note message cannot be whitespace-only.",
    }),
  createdAt: z.string().datetime({ message: "createdAt must be a valid ISO 8601 UTC timestamp." }),
});

export type IncidentNote = z.infer<typeof IncidentNoteSchema>;

// ----------------------------------------------------------------------------
// 5. Core Incident Entity
// ----------------------------------------------------------------------------

export const IncidentSchema = z.object({
  id: z.string().regex(/^INC-\d+$/, "Incident ID must match pattern INC-<number> (e.g. INC-1042)."),
  title: z
    .string()
    .min(5, "Title must contain at least 5 characters.")
    .max(120, "Title cannot exceed 120 characters.")
    .refine((val) => isNaN(Number(val.trim())), {
      message: "Title cannot be purely numeric.",
    }),
  description: z
    .string()
    .min(20, "Description must contain at least 20 characters.")
    .max(2000, "Description cannot exceed 2000 characters."),
  status: IncidentStatusSchema,
  severity: IncidentSeveritySchema,
  service: z.string().min(1, "Service name cannot be empty."),
  assignee: UserSummarySchema.nullable(),
  createdAt: z.string().datetime({ message: "createdAt must be a valid ISO 8601 UTC timestamp." }),
  updatedAt: z.string().datetime({ message: "updatedAt must be a valid ISO 8601 UTC timestamp." }),
  version: z.number().int().positive("Version must be a positive integer."),
  notes: z.array(IncidentNoteSchema),
});

export type Incident = z.infer<typeof IncidentSchema>;

// ----------------------------------------------------------------------------
// 6. Mutation Input Schemas & Types
// ----------------------------------------------------------------------------

/**
 * Allowed initial status for incident creation.
 * Notice: 'resolved' is strictly disallowed upon creation.
 */
export const INITIAL_INCIDENT_STATUSES = [
  "triggered",
  "acknowledged",
  "investigating",
] as const;

export type InitialIncidentStatus = (typeof INITIAL_INCIDENT_STATUSES)[number];

export const InitialIncidentStatusSchema = z.enum(INITIAL_INCIDENT_STATUSES, {
  errorMap: () => ({
    message: "Initial status must be one of: triggered, acknowledged, investigating (cannot create as resolved).",
  }),
});

export const IncidentCreateInputSchema = z.object({
  title: z
    .string({ required_error: "Title is required." })
    .trim()
    .min(5, "Title must contain at least 5 characters.")
    .max(120, "Title cannot exceed 120 characters.")
    .refine((val) => isNaN(Number(val)), {
      message: "Title cannot be purely numeric.",
    }),
  description: z
    .string({ required_error: "Description is required." })
    .trim()
    .min(20, "Description must contain at least 20 characters.")
    .max(2000, "Description cannot exceed 2000 characters."),
  status: InitialIncidentStatusSchema.default("triggered"),
  severity: IncidentSeveritySchema.default("high"),
  service: z
    .string({ required_error: "Service is required." })
    .trim()
    .min(1, "Service cannot be empty."),
  assigneeId: z.string().nullable().optional(),
});

export type IncidentCreateInput = z.infer<typeof IncidentCreateInputSchema>;

export const IncidentStatusUpdateInputSchema = z.object({
  status: IncidentStatusSchema,
  version: z.number().int().positive().optional(),
});

export type IncidentStatusUpdateInput = z.infer<typeof IncidentStatusUpdateInputSchema>;

export const IncidentAssigneeUpdateInputSchema = z.object({
  assigneeId: z.string().nullable(),
});

export type IncidentAssigneeUpdateInput = z.infer<typeof IncidentAssigneeUpdateInputSchema>;

export const IncidentNoteCreateInputSchema = z.object({
  message: z
    .string({ required_error: "Message is required." })
    .trim()
    .min(1, "Investigation note cannot be empty or whitespace-only.")
    .max(5000, "Investigation note cannot exceed 5000 characters."),
});

export type IncidentNoteCreateInput = z.infer<typeof IncidentNoteCreateInputSchema>;
