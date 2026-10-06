import { http, HttpResponse, delay as mswDelay } from "msw";
import { z } from "zod";
import { store, incidentStore } from "../db/store.ts";
import { MOCK_SERVICES, MOCK_USERS } from "../db/seed.ts";
import {
  isValidStatusTransition,
  IncidentCreateInputSchema,
  IncidentStatusUpdateInputSchema,
  IncidentAssigneeUpdateInputSchema,
  IncidentNoteCreateInputSchema,
} from "../contracts/incident.types.ts";
import {
  API_ERROR_CODES,
  ApiErrorEnvelope,
} from "../contracts/api.types.ts";

/**
 * Evaluates simulation rules (latency & chaos failure injection) for MSW requests.
 * Health endpoints bypass simulation entirely.
 */
async function handleSimulation(
  request: Request,
  isMutation: boolean = false
): Promise<HttpResponse<any> | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    url = new URL(request.url, "http://localhost");
  }

  // 1. Health route check: exempt from latency and chaos simulation
  const pathname = url.pathname;
  if (
    pathname === "/health" ||
    pathname === "/api/health" ||
    pathname.endsWith("/health")
  ) {
    return null;
  }

  // 2. Latency delay
  const rawDelay =
    request.headers.get("x-mock-delay") ??
    url.searchParams.get("delay") ??
    url.searchParams.get("__mock_delay") ??
    url.searchParams.get("mock_delay");

  let explicitDelayMs: number | undefined;
  if (rawDelay !== null && rawDelay !== undefined) {
    const parsed = parseInt(rawDelay, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      explicitDelayMs = parsed;
    }
  }

  const testBypassHeader =
    request.headers.get("x-test-bypass") ??
    url.searchParams.get("test-bypass") ??
    url.searchParams.get("x-test-bypass");

  const hasExplicitBypass = testBypassHeader?.toLowerCase() === "true";
  const hasExplicitNoBypass = testBypassHeader?.toLowerCase() === "false";

  const envTestMode = process.env.TEST_MODE;
  const isEnvTestModeTrue = envTestMode === "true";
  const isEnvTestModeFalse = envTestMode === "false";

  const isTestEnv =
    Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

  let delayMs = 0;

  if (hasExplicitBypass || isEnvTestModeTrue) {
    delayMs = 0;
  } else if (explicitDelayMs !== undefined) {
    delayMs = explicitDelayMs;
  } else if (hasExplicitNoBypass || isEnvTestModeFalse) {
    delayMs = Math.floor(Math.random() * (1200 - 200 + 1)) + 200;
  } else if (isTestEnv) {
    delayMs = 0;
  } else {
    delayMs = Math.floor(Math.random() * (1200 - 200 + 1)) + 200;
  }

  if (delayMs > 0) {
    await mswDelay(delayMs);
  }

  // 3. Chaos failure injection
  const rawFailure =
    request.headers.get("x-mock-failure") ??
    url.searchParams.get("failure") ??
    url.searchParams.get("__mock_failure") ??
    url.searchParams.get("mock_failure");

  const failure = rawFailure?.trim().toLowerCase();

  const rawConflict =
    request.headers.get("x-mock-conflict") ??
    url.searchParams.get("conflict") ??
    url.searchParams.get("__mock_conflict") ??
    url.searchParams.get("mock_conflict");

  const isConflictRequested =
    rawConflict?.toLowerCase() === "true" || rawConflict === "1";

  if (isConflictRequested && isMutation) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
        message: "Chaos simulation: simulated concurrency conflict.",
        currentVersion: 999,
        error: {
          code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
          message: "Chaos simulation: simulated concurrency conflict.",
          currentVersion: 999,
        },
      },
      { status: 409 }
    );
  }

  if (failure) {
    if (failure === "500" || failure === "internal_server_error" || failure === "true") {
      return HttpResponse.json(
        {
          code: API_ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: "Chaos simulation: simulated internal server error.",
          error: {
            code: API_ERROR_CODES.INTERNAL_SERVER_ERROR,
            message: "Chaos simulation: simulated internal server error.",
          },
        },
        { status: 500 }
      );
    }
    if (failure === "503" || failure === "service_unavailable") {
      return HttpResponse.json(
        {
          code: "SERVICE_UNAVAILABLE",
          message: "Chaos simulation: simulated service outage.",
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Chaos simulation: simulated service outage.",
          },
        },
        { status: 503 }
      );
    }
    if (failure === "504" || failure === "gateway_timeout") {
      return HttpResponse.json(
        {
          code: "GATEWAY_TIMEOUT",
          message: "Chaos simulation: simulated gateway timeout.",
          error: {
            code: "GATEWAY_TIMEOUT",
            message: "Chaos simulation: simulated gateway timeout.",
          },
        },
        { status: 504 }
      );
    }
    if (failure === "429" || failure === "rate_limit_exceeded") {
      return HttpResponse.json(
        {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Chaos simulation: rate limit exceeded. Retry after 30s.",
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Chaos simulation: rate limit exceeded. Retry after 30s.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": "30" },
        }
      );
    }
    if (failure === "400" || failure === "validation_error") {
      return HttpResponse.json(
        {
          code: API_ERROR_CODES.VALIDATION_ERROR,
          message: "Chaos simulation: simulated bad request.",
          error: {
            code: API_ERROR_CODES.VALIDATION_ERROR,
            message: "Chaos simulation: simulated bad request.",
          },
        },
        { status: 400 }
      );
    }
    if (failure === "404" || failure === "incident_not_found" || failure === "not_found") {
      return HttpResponse.json(
        {
          code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
          message: "Chaos simulation: simulated resource not found.",
          error: {
            code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
            message: "Chaos simulation: simulated resource not found.",
          },
        },
        { status: 404 }
      );
    }
    if (failure === "409" || failure === "incident_version_conflict" || failure === "conflict") {
      return HttpResponse.json(
        {
          code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
          message: "Chaos simulation: simulated concurrency conflict.",
          currentVersion: 999,
          error: {
            code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
            message: "Chaos simulation: simulated concurrency conflict.",
            currentVersion: 999,
          },
        },
        { status: 409 }
      );
    }
    if (failure === "timeout") {
      await mswDelay(15000);
      return HttpResponse.json(
        {
          code: "GATEWAY_TIMEOUT",
          message: "Chaos simulation: simulated gateway timeout.",
          error: {
            code: "GATEWAY_TIMEOUT",
            message: "Chaos simulation: simulated gateway timeout.",
          },
        },
        { status: 504 }
      );
    }
    if (failure === "network-error" || failure === "network_error") {
      return HttpResponse.error();
    }
  }

  return null;
}

// ----------------------------------------------------------------------------
// Endpoint Handlers
// ----------------------------------------------------------------------------

function handleHealth() {
  return HttpResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      uptime: process.uptime(),
      totalIncidents: store.count(),
    },
    { status: 200 }
  );
}

async function handleListIncidents({ request }: { request: Request }) {
  const sim = await handleSimulation(request, false);
  if (sim) return sim;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    url = new URL(request.url, "http://localhost");
  }

  const queryObj: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    queryObj[key] = value;
  }

  const paginated = store.query(queryObj as any);
  return HttpResponse.json(paginated, { status: 200 });
}

async function handleGetIncident({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
}) {
  const sim = await handleSimulation(request, false);
  if (sim) return sim;

  const id = String(params.id);
  const incident = store.findById(id);
  if (!incident) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
        message: "The requested incident does not exist.",
        error: {
          code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
          message: "The requested incident does not exist.",
        },
      },
      { status: 404 }
    );
  }

  return HttpResponse.json(incident, { status: 200 });
}

async function handleCreateIncident({ request }: { request: Request }) {
  const sim = await handleSimulation(request, true);
  if (sim) return sim;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Malformed JSON payload.",
      },
      { status: 400 }
    );
  }

  if (body?.status === "resolved") {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Incident cannot be created directly in resolved status.",
        fieldErrors: {
          status: ["Incident cannot be created directly in resolved status."],
        },
      },
      { status: 400 }
    );
  }

  const parsed = IncidentCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "The submitted incident is invalid.",
        fieldErrors,
      },
      { status: 400 }
    );
  }

  if (parsed.data.assigneeId && !MOCK_USERS.some((u) => u.id === parsed.data.assigneeId)) {
    return HttpResponse.json(
      {
        code: "USER_NOT_FOUND",
        message: "The specified assignee does not exist.",
      },
      { status: 400 }
    );
  }

  const created = store.create(parsed.data);
  return HttpResponse.json(created, { status: 201 });
}

async function handleUpdateStatus({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
}) {
  const sim = await handleSimulation(request, true);
  if (sim) return sim;

  const id = String(params.id);
  const existing = store.findById(id);
  if (!existing) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
        message: "The requested incident does not exist.",
      },
      { status: 404 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Malformed JSON payload.",
      },
      { status: 400 }
    );
  }

  const StatusSchema = IncidentStatusUpdateInputSchema.extend({
    version: z.number().int().min(0).optional(),
  });

  const parsed = StatusSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString() || "status";
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Invalid status update payload.",
        fieldErrors,
      },
      { status: 400 }
    );
  }

  if (parsed.data.version !== undefined && parsed.data.version !== existing.version) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
        message: "The incident was changed by another user.",
        currentVersion: existing.version,
      },
      { status: 409 }
    );
  }

  if (!isValidStatusTransition(existing.status, parsed.data.status)) {
    return HttpResponse.json(
      {
        code: "INVALID_TRANSITION",
        message: `Cannot transition incident directly from '${existing.status}' to '${parsed.data.status}'.`,
      },
      { status: 400 }
    );
  }

  const result = store.updateStatus(id, parsed.data);
  return HttpResponse.json(result, { status: 200 });
}

async function handleUpdateAssignee({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
}) {
  const sim = await handleSimulation(request, true);
  if (sim) return sim;

  const id = String(params.id);
  const existing = store.findById(id);
  if (!existing) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
        message: "The requested incident does not exist.",
      },
      { status: 404 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Malformed JSON payload.",
      },
      { status: 400 }
    );
  }

  const AssigneeSchema = IncidentAssigneeUpdateInputSchema.extend({
    version: z.number().int().min(0).optional(),
  });

  const parsed = AssigneeSchema.safeParse(body);
  if (!parsed.success) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Invalid assignee payload.",
      },
      { status: 400 }
    );
  }

  if (parsed.data.version !== undefined && parsed.data.version !== existing.version) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.INCIDENT_VERSION_CONFLICT,
        message: "The incident was changed by another user.",
        currentVersion: existing.version,
      },
      { status: 409 }
    );
  }

  if (
    typeof parsed.data.assigneeId === "string" &&
    !MOCK_USERS.some((u) => u.id === parsed.data.assigneeId)
  ) {
    return HttpResponse.json(
      {
        code: "USER_NOT_FOUND",
        message: "The specified assignee does not exist.",
      },
      { status: 400 }
    );
  }

  const updated = store.updateAssignee(id, parsed.data);
  return HttpResponse.json(updated, { status: 200 });
}

async function handleCreateNote({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
}) {
  const sim = await handleSimulation(request, true);
  if (sim) return sim;

  const id = String(params.id);
  const existing = store.findById(id);
  if (!existing) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.INCIDENT_NOT_FOUND,
        message: "The requested incident does not exist.",
      },
      { status: 404 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Malformed JSON payload.",
      },
      { status: 400 }
    );
  }

  const rawMessage = body?.message;
  if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Investigation note cannot be empty or whitespace-only.",
        fieldErrors: {
          message: ["Note message cannot be empty or whitespace-only."],
        },
      },
      { status: 400 }
    );
  }

  const parsed = IncidentNoteCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString() || "message";
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }
    return HttpResponse.json(
      {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Investigation note cannot be empty or whitespace-only.",
        fieldErrors,
      },
      { status: 400 }
    );
  }

  const note = store.createNote(id, {
    ...parsed.data,
    message: rawMessage.trim(),
    authorId: body?.authorId,
  });
  return HttpResponse.json(note, { status: 201 });
}

async function handleServices({ request }: { request: Request }) {
  const sim = await handleSimulation(request, false);
  if (sim) return sim;
  return HttpResponse.json({ items: MOCK_SERVICES }, { status: 200 });
}

async function handleUsers({ request }: { request: Request }) {
  const sim = await handleSimulation(request, false);
  if (sim) return sim;
  return HttpResponse.json({ items: MOCK_USERS }, { status: 200 });
}

// ----------------------------------------------------------------------------
// Exported MSW Handlers Array
// ----------------------------------------------------------------------------

export const handlers = [
  // Health endpoints
  http.get("*/health", handleHealth),
  http.get("/health", handleHealth),
  http.get("*/api/health", handleHealth),
  http.get("/api/health", handleHealth),

  // Incidents collection endpoints
  http.get("*/api/incidents", handleListIncidents),
  http.get("/api/incidents", handleListIncidents),
  http.post("*/api/incidents", handleCreateIncident),
  http.post("/api/incidents", handleCreateIncident),

  // Incidents detail and mutation endpoints
  http.get("*/api/incidents/:id", handleGetIncident),
  http.get("/api/incidents/:id", handleGetIncident),
  http.patch("*/api/incidents/:id/status", handleUpdateStatus),
  http.patch("/api/incidents/:id/status", handleUpdateStatus),
  http.patch("*/api/incidents/:id/assignee", handleUpdateAssignee),
  http.patch("/api/incidents/:id/assignee", handleUpdateAssignee),
  http.post("*/api/incidents/:id/notes", handleCreateNote),
  http.post("/api/incidents/:id/notes", handleCreateNote),

  // Metadata directory endpoints
  http.get("*/api/services", handleServices),
  http.get("/api/services", handleServices),
  http.get("*/api/users", handleUsers),
  http.get("/api/users", handleUsers),
];

export {
  handleHealth,
  handleListIncidents,
  handleGetIncident,
  handleCreateIncident,
  handleUpdateStatus,
  handleUpdateAssignee,
  handleCreateNote,
  handleServices,
  handleUsers,
  handleSimulation,
};
