import {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentCreateInput,
  IncidentStatusUpdateInput,
  IncidentAssigneeUpdateInput,
  IncidentNoteCreateInput,
  IncidentNote,
  UserSummary,
  SEVERITY_ORDER,
  isValidStatusTransition,
} from "../contracts/incident.types.ts";
import {
  GetIncidentsQuery,
  ParsedIncidentsQuery,
  IncidentsListResponse,
  IncidentSortField,
  SortOrder,
  UpdateIncidentStatusResponse,
  parseAndSanitizeQuery,
} from "../contracts/api.types.ts";
import { generateSeedIncidents, MOCK_USERS } from "./seed.ts";

/**
 * ============================================================================
 * AtlasOps Incident Management Console - In-Memory Store & Query Engine
 * ============================================================================
 * High-performance in-memory repository managing the incident lifecycle,
 * multi-value dimension filtering, full-text substring search, multi-column
 * sorting, clamped pagination, and atomic mutations with optimistic concurrency.
 */

export type SupportedSortField = IncidentSortField | "status" | "title" | "id";

export type StoreErrorCode = "NOT_FOUND" | "CONFLICT" | "INVALID_TRANSITION" | "USER_NOT_FOUND";

export class StoreError extends Error {
  public readonly code: StoreErrorCode;
  public readonly currentVersion?: number;

  constructor(code: StoreErrorCode, message: string, currentVersion?: number) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.currentVersion = currentVersion;
  }
}

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
   * Returns a deep defensive copy of all incidents currently in the store
   * so external consumers cannot accidentally mutate internal state.
   */
  public getAll(): Incident[] {
    return this.incidents.map((inc) => ({
      ...inc,
      notes: [...inc.notes],
    }));
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
   * Determines the next sequential incident ID starting after the seed range (e.g. INC-2049).
   */
  private getNextIncidentId(): string {
    let maxNum = 2048;
    for (const inc of this.incidents) {
      const match = inc.id.match(/^INC-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return `INC-${maxNum + 1}`;
  }

  /**
   * Creates a new incident with next sequential ID, version 1, and empty notes.
   */
  public create(input: IncidentCreateInput): Incident {
    const id = this.getNextIncidentId();
    let assignee: UserSummary | null = null;
    if (input.assigneeId) {
      const user = MOCK_USERS.find((u) => u.id === input.assigneeId);
      if (user) {
        assignee = user;
      }
    }

    const now = new Date().toISOString();
    const incident: Incident = {
      id,
      title: input.title,
      description: input.description,
      status: input.status,
      severity: input.severity,
      service: input.service,
      assignee,
      createdAt: now,
      updatedAt: now,
      version: 1,
      notes: [],
    };

    this.incidents.push(incident);
    return incident;
  }

  /**
   * Updates incident status with lifecycle transition validation and optimistic concurrency.
   * Throws StoreError on validation or concurrency failure.
   */
  public updateStatus(
    id: string,
    input: IncidentStatusUpdateInput
  ): UpdateIncidentStatusResponse {
    const incident = this.findById(id);
    if (!incident) {
      throw new StoreError("NOT_FOUND", "The requested incident does not exist.");
    }

    if (input.version !== undefined && input.version !== incident.version) {
      throw new StoreError(
        "CONFLICT",
        "The incident was changed by another user.",
        incident.version
      );
    }

    if (!isValidStatusTransition(incident.status, input.status)) {
      throw new StoreError(
        "INVALID_TRANSITION",
        `Cannot transition incident directly from '${incident.status}' to '${input.status}'.`
      );
    }

    incident.status = input.status;
    incident.version += 1;
    incident.updatedAt = new Date().toISOString();

    return {
      id: incident.id,
      status: incident.status,
      updatedAt: incident.updatedAt,
      version: incident.version,
    };
  }

  /**
   * Updates or unassigns incident owner with optimistic concurrency checks.
   * Throws StoreError on validation or concurrency failure.
   */
  public updateAssignee(
    id: string,
    input: IncidentAssigneeUpdateInput & { version?: number }
  ): Incident {
    const incident = this.findById(id);
    if (!incident) {
      throw new StoreError("NOT_FOUND", "The requested incident does not exist.");
    }

    if (input.version !== undefined && input.version !== incident.version) {
      throw new StoreError(
        "CONFLICT",
        "The incident was changed by another user.",
        incident.version
      );
    }

    if (input.assigneeId === null) {
      incident.assignee = null;
    } else if (typeof input.assigneeId === "string") {
      const user = MOCK_USERS.find((u) => u.id === input.assigneeId);
      if (!user) {
        throw new StoreError("USER_NOT_FOUND", "The specified assignee does not exist.");
      }
      incident.assignee = user;
    }

    incident.version += 1;
    incident.updatedAt = new Date().toISOString();

    return incident;
  }

  /**
   * Appends an investigation note to an existing incident and updates its updatedAt timestamp.
   * Throws StoreError if incident is not found.
   */
  public createNote(
    id: string,
    input: IncidentNoteCreateInput & { authorId?: string }
  ): IncidentNote {
    const incident = this.findById(id);
    if (!incident) {
      throw new StoreError("NOT_FOUND", "The requested incident does not exist.");
    }

    let author = MOCK_USERS[0]; // Default: Maya Chen
    if (input.authorId) {
      const matched = MOCK_USERS.find((u) => u.id === input.authorId);
      if (matched) {
        author = matched;
      }
    }

    const noteId = `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const note: IncidentNote = {
      id: noteId,
      incidentId: incident.id,
      author,
      message: input.message.trim(),
      createdAt: now,
    };

    incident.notes.push(note);
    incident.updatedAt = now;

    return note;
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
