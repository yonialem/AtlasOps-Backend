import {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  SEVERITY_ORDER,
} from "../contracts/incident.types.ts";
import {
  GetIncidentsQuery,
  ParsedIncidentsQuery,
  IncidentsListResponse,
  IncidentSortField,
  SortOrder,
  parseAndSanitizeQuery,
} from "../contracts/api.types.ts";
import { generateSeedIncidents } from "./seed.ts";

/**
 * ============================================================================
 * AtlasOps Incident Management Console - In-Memory Store & Query Engine
 * ============================================================================
 * High-performance in-memory repository managing the incident lifecycle,
 * multi-value dimension filtering, full-text substring search, multi-column
 * sorting, and pagination.
 */

export type SupportedSortField = IncidentSortField | "status" | "title" | "id";

/**
 * Pure sorting function for Incident entities.
 * Supports primary sort with deterministic secondary tie-breaker:
 * `updatedAt` desc, then `id` asc.
 */
export function sortIncidents(
  incidents: Incident[],
  field: string = "updatedAt",
  order: string = "desc"
): Incident[] {
  const dir = order === "asc" ? 1 : -1;

  return [...incidents].sort((a, b) => {
    let diff = 0;

    if (field === "severity") {
      diff = (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) * dir;
    } else if (field === "status") {
      diff = a.status.localeCompare(b.status) * dir;
    } else if (field === "title") {
      diff = a.title.localeCompare(b.title) * dir;
    } else if (field === "id") {
      diff = a.id.localeCompare(b.id) * dir;
    } else if (field === "createdAt") {
      diff = (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
    } else {
      // Default: updatedAt
      diff = (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * dir;
    }

    if (diff !== 0) return diff;

    // Secondary tie-breaker: updatedAt desc, then id asc
    if (field !== "updatedAt") {
      const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (updatedDiff !== 0) return updatedDiff;
    }

    return a.id.localeCompare(b.id);
  });
}

export class IncidentStore {
  private incidents: Incident[];

  constructor(initialIncidents?: Incident[]) {
    this.incidents = initialIncidents ? [...initialIncidents] : generateSeedIncidents();
  }

  /**
   * Returns a shallow copy of all incidents currently in the store.
   */
  public getAll(): Incident[] {
    return [...this.incidents];
  }

  /**
   * Returns the total count of incidents in the store.
   */
  public count(): number {
    return this.incidents.length;
  }

  /**
   * Retrieves an incident by its unique ID (e.g. "INC-1042").
   * Returns undefined if not found.
   */
  public findById(id: string): Incident | undefined {
    return this.incidents.find((inc) => inc.id === id);
  }

  /**
   * Resets the internal incident collection to a pristine deterministic seed dataset.
   */
  public reset(seed?: number): void {
    this.incidents = generateSeedIncidents(seed);
  }

  /**
   * Executes multi-dimensional filtering, text search, sorting, and clamped pagination.
   */
  public query(query?: Partial<GetIncidentsQuery> | ParsedIncidentsQuery): IncidentsListResponse {
    const rawQuery = (query ?? {}) as Record<string, unknown>;

    // 1. Parse and sanitize query parameters
    const sanitized = parseAndSanitizeQuery(rawQuery as Partial<GetIncidentsQuery>);

    // Handle extended sort fields ("status" | "title" | "id") if passed
    const rawSort = typeof rawQuery.sort === "string" ? rawQuery.sort : undefined;
    const sortField: string =
      rawSort && ["updatedAt", "createdAt", "severity", "status", "title", "id"].includes(rawSort)
        ? rawSort
        : sanitized.sort;

    const sortOrder: SortOrder =
      rawQuery.order === "asc" || rawQuery.order === "desc" ? rawQuery.order : sanitized.order;

    // Extract multi-value filters (support both raw comma-separated strings and parsed arrays)
    let statuses: IncidentStatus[] = sanitized.statuses;
    if (Array.isArray(rawQuery.statuses)) {
      statuses = rawQuery.statuses as IncidentStatus[];
    } else if (typeof rawQuery.status === "string" && rawQuery.status.trim().length > 0) {
      const validStatuses: IncidentStatus[] = ["triggered", "acknowledged", "investigating", "resolved"];
      statuses = rawQuery.status
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is IncidentStatus => validStatuses.includes(s as IncidentStatus));
    }

    let severities: IncidentSeverity[] = sanitized.severities;
    if (Array.isArray(rawQuery.severities)) {
      severities = rawQuery.severities as IncidentSeverity[];
    } else if (typeof rawQuery.severity === "string" && rawQuery.severity.trim().length > 0) {
      const validSeverities: IncidentSeverity[] = ["critical", "high", "medium", "low"];
      severities = rawQuery.severity
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is IncidentSeverity => validSeverities.includes(s as IncidentSeverity));
    }

    let services: string[] = sanitized.services;
    if (Array.isArray(rawQuery.services)) {
      services = rawQuery.services as string[];
    } else if (typeof rawQuery.service === "string" && rawQuery.service.trim().length > 0) {
      services = rawQuery.service
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    const needle = (typeof rawQuery.q === "string" ? rawQuery.q : sanitized.q).trim().toLowerCase();

    // 2. Filter Pipeline: Logical AND across dimensions, logical OR within multi-value filters
    const filtered = this.incidents.filter((incident) => {
      // Substring search (q) matching id, title, service, or assignee name
      if (needle.length > 0) {
        const idMatch = incident.id.toLowerCase().includes(needle);
        const titleMatch = incident.title.toLowerCase().includes(needle);
        const serviceMatch = incident.service.toLowerCase().includes(needle);
        const assigneeMatch =
          incident.assignee !== null && incident.assignee.name.toLowerCase().includes(needle);

        if (!idMatch && !titleMatch && !serviceMatch && !assigneeMatch) {
          return false;
        }
      }

      // Status filter
      if (statuses.length > 0 && !statuses.includes(incident.status)) {
        return false;
      }

      // Severity filter
      if (severities.length > 0 && !severities.includes(incident.severity)) {
        return false;
      }

      // Service filter
      if (services.length > 0 && !services.includes(incident.service)) {
        return false;
      }

      return true;
    });

    // 3. Sorting Pipeline
    const sorted = sortIncidents(filtered, sortField, sortOrder);

    // 4. Clamped Pagination
    const total = sorted.length;
    const rawPage = Number(rawQuery.page);
    const page = isNaN(rawPage) || rawPage < 1 ? 1 : Math.floor(rawPage);

    const rawPageSize = Number(rawQuery.pageSize);
    let pageSize = isNaN(rawPageSize) ? 25 : Math.floor(rawPageSize);
    if (pageSize < 10) pageSize = 10;
    if (pageSize > 100) pageSize = 100;

    const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);

    const startIndex = (page - 1) * pageSize;
    const items = startIndex >= total ? [] : sorted.slice(startIndex, startIndex + pageSize);

    return {
      items,
      page,
      pageSize,
      total,
      totalPages,
    };
  }
}

// Singleton store instance
export const incidentStore = new IncidentStore();
export const store = incidentStore;
