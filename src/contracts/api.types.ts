import { z } from "zod";
import {
  Incident,
  IncidentSchema,
  IncidentStatus,
  IncidentStatusSchema,
  IncidentSeverity,
  UserSummarySchema,
  IncidentNote,
} from "./incident.types.ts";

/**
 * ============================================================================
 * AtlasOps Incident Management Console - API & Protocol Contracts
 * ============================================================================
 * File: contracts/api.types.ts
 * Single Source of Truth for Request Query Filters, Pagination, Response
 * Envelopes, Error Payloads, and Endpoint Parameter Schemas.
 */

// ----------------------------------------------------------------------------
// 1. Sorting & Query Constants
// ----------------------------------------------------------------------------

export const INCIDENT_SORT_FIELDS = [
  "updatedAt",
  "createdAt",
  "severity",
] as const;

export type IncidentSortField = (typeof INCIDENT_SORT_FIELDS)[number];

export const IncidentSortFieldSchema = z.enum(INCIDENT_SORT_FIELDS, {
  errorMap: () => ({ message: "Sort field must be one of: updatedAt, createdAt, severity." }),
});

export const SORT_ORDERS = ["asc", "desc"] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

export const SortOrderSchema = z.enum(SORT_ORDERS, {
  errorMap: () => ({ message: "Sort order must be one of: asc, desc." }),
});

export const ALLOWED_PAGE_SIZES = [10, 25, 50, 100] as const;

export type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number];

// ----------------------------------------------------------------------------
// 2. Incident List Query Parameters Contract
// ----------------------------------------------------------------------------

/**
 * Raw query parameters received via HTTP GET /api/incidents or browser URL SearchParams.
 */
export const GetIncidentsQuerySchema = z.object({
  /**
   * Substring search string matching id, title, service, or assignee.name (case-insensitive).
   */
  q: z.string().optional().default(""),

  /**
   * Comma-separated list of IncidentStatus tokens (e.g. "triggered,investigating").
   */
  status: z.string().optional().default(""),

  /**
   * Comma-separated list of IncidentSeverity tokens (e.g. "critical,high").
   */
  severity: z.string().optional().default(""),

  /**
   * Comma-separated list of service identifiers (e.g. "payments-api,checkout-web").
   */
  service: z.string().optional().default(""),

  /**
   * Sort field identifier (default: updatedAt).
   */
  sort: IncidentSortFieldSchema.optional().default("updatedAt"),

  /**
   * Sort direction: desc (newest/highest severity first) or asc.
   */
  order: SortOrderSchema.optional().default("desc"),

  /**
   * 1-indexed page number (coerced from string or number; values < 1 clamped to 1).
   */
  page: z
    .preprocess((val) => {
      if (typeof val === "string") {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? 1 : Math.max(1, parsed);
      }
      if (typeof val === "number") return Math.max(1, Math.floor(val));
      return 1;
    }, z.number().int().min(1))
    .default(1),

  /**
   * Page size (coerced from string or number; clamped between 10 and 100, default 25).
   */
  pageSize: z
    .preprocess((val) => {
      if (typeof val === "string") {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed) || parsed < 1) return 10;
        if (parsed > 100) return 100;
        return parsed;
      }
      if (typeof val === "number") {
        if (val < 1) return 10;
        if (val > 100) return 100;
        return Math.floor(val);
      }
      return 25;
    }, z.number().int().min(1).max(100))
    .default(25),
});

export type GetIncidentsQuery = z.infer<typeof GetIncidentsQuerySchema>;

/**
 * Sanitized, typed query representation after tokenizing comma-separated filter strings.
 */
export interface ParsedIncidentsQuery {
  q: string;
  statuses: IncidentStatus[];
  severities: IncidentSeverity[];
  services: string[];
  sort: IncidentSortField;
  order: SortOrder;
  page: number;
  pageSize: number;
}

/**
 * Utility parser that validates and tokenizes raw GetIncidentsQuery into ParsedIncidentsQuery,
 * safely discarding unrecognized enum tokens.
 */
export function parseAndSanitizeQuery(query: Partial<GetIncidentsQuery>): ParsedIncidentsQuery {
  const q = (query.q ?? "").trim();
  const sort = INCIDENT_SORT_FIELDS.includes(query.sort as IncidentSortField)
    ? (query.sort as IncidentSortField)
    : "updatedAt";
  const order = SORT_ORDERS.includes(query.order as SortOrder)
    ? (query.order as SortOrder)
    : "desc";

  const rawPage = Number(query.page);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : Math.floor(rawPage);

  const rawPageSize = Number(query.pageSize);
  let pageSize = isNaN(rawPageSize) ? 25 : Math.floor(rawPageSize);
  if (pageSize < 1) pageSize = 10;
  if (pageSize > 100) pageSize = 100;

  const validStatuses: IncidentStatus[] = ["triggered", "acknowledged", "investigating", "resolved"];
  const statuses: IncidentStatus[] = query.status
    ? (query.status
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is IncidentStatus => validStatuses.includes(s as IncidentStatus)))
    : [];

  const validSeverities: IncidentSeverity[] = ["critical", "high", "medium", "low"];
  const severities: IncidentSeverity[] = query.severity
    ? (query.severity
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is IncidentSeverity => validSeverities.includes(s as IncidentSeverity)))
    : [];

  const services: string[] = query.service
    ? query.service
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  return {
    q,
    statuses,
    severities,
    services,
    sort,
    order,
    page,
    pageSize,
  };
}

// ----------------------------------------------------------------------------
// 3. Paginated Response Envelope
// ----------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(1),
  });
}

export const IncidentsListResponseSchema = createPaginatedResponseSchema(IncidentSchema);

export type IncidentsListResponse = PaginatedResponse<Incident>;

// ----------------------------------------------------------------------------
// 4. Standard Error Response Envelope
// ----------------------------------------------------------------------------

export const API_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INCIDENT_NOT_FOUND: "INCIDENT_NOT_FOUND",
  INCIDENT_VERSION_CONFLICT: "INCIDENT_VERSION_CONFLICT",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES] | string;

export const ApiErrorEnvelopeSchema = z.object({
  code: z.string().min(1, "Error code is required."),
  message: z.string().min(1, "Error message is required."),
  fieldErrors: z.record(z.array(z.string())).optional(),
  currentVersion: z.number().int().optional(),
});

export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

// ----------------------------------------------------------------------------
// 5. Endpoint Specific Request & Response Contracts
// ----------------------------------------------------------------------------

// GET /api/incidents/:incidentId
export const GetIncidentParamsSchema = z.object({
  incidentId: z.string().regex(/^INC-\d+$/, "Incident ID must match pattern INC-<number>."),
});

export type GetIncidentParams = z.infer<typeof GetIncidentParamsSchema>;
export type GetIncidentResponse = Incident;

// PATCH /api/incidents/:incidentId/status
export const UpdateIncidentStatusParamsSchema = GetIncidentParamsSchema;
export type UpdateIncidentStatusParams = z.infer<typeof UpdateIncidentStatusParamsSchema>;

export const UpdateIncidentStatusResponseSchema = z.object({
  id: z.string(),
  status: IncidentStatusSchema,
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
});

export type UpdateIncidentStatusResponse = z.infer<typeof UpdateIncidentStatusResponseSchema>;

// PATCH /api/incidents/:incidentId/assignee
export const UpdateIncidentAssigneeParamsSchema = GetIncidentParamsSchema;
export type UpdateIncidentAssigneeParams = z.infer<typeof UpdateIncidentAssigneeParamsSchema>;
export type UpdateIncidentAssigneeResponse = Incident;

// POST /api/incidents/:incidentId/notes
export const CreateIncidentNoteParamsSchema = GetIncidentParamsSchema;
export type CreateIncidentNoteParams = z.infer<typeof CreateIncidentNoteParamsSchema>;
export type CreateIncidentNoteResponse = IncidentNote;

// GET /api/users
export const ListUsersResponseSchema = z.object({
  items: z.array(UserSummarySchema),
});

export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;

// GET /api/services
export const ListServicesResponseSchema = z.object({
  items: z.array(z.string().min(1)),
});

export type ListServicesResponse = z.infer<typeof ListServicesResponseSchema>;

// GET /api/incidents/events (Server-Sent Events)
export const INCIDENT_EVENT_TYPES = [
  "incident.created",
  "incident.updated",
  "incident.assigned",
  "incident.note_added",
] as const;

export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number];

export const IncidentEventSchema = z.object({
  type: z.enum(INCIDENT_EVENT_TYPES),
  incident: z.object({
    id: z.string(),
    status: IncidentStatusSchema.optional(),
    updatedAt: z.string().optional(),
    version: z.number().optional(),
    assignee: UserSummarySchema.nullable().optional(),
  }),
});

export type IncidentServerEvent = z.infer<typeof IncidentEventSchema>;

// ----------------------------------------------------------------------------
// 6. Mock Control Headers & Chaos Simulation
// ----------------------------------------------------------------------------

export const MOCK_HEADERS = {
  FAILURE: "X-Mock-Failure",
  DELAY: "X-Mock-Delay",
  CONFLICT: "X-Mock-Conflict",
} as const;

export const MOCK_FAILURE_MODES = [
  "500",
  "400",
  "404",
  "409",
  "timeout",
  "network-error",
] as const;

export type MockFailureMode = (typeof MOCK_FAILURE_MODES)[number];
