# AtlasOps Incident Management Console: REST API & Mock Specification

**Document Version:** 1.1.0  
**Status:** REVISED / READY FOR AUDIT  
**Author:** Spec Generator Agent  
**Target Audience:** System Architects, Backend Engineers, Frontend Engineers, QA / Test Engineers  

---

## 1. Overview and Design Principles

This specification defines the authoritative REST API contract and Mock Server requirements for the AtlasOps Incident Management Console.

### 1.1 Architectural Guarantees
1. **HTTP Standards Compliance:** Strict adherence to standard HTTP methods (`GET`, `POST`, `PATCH`), proper status codes (`200`, `201`, `400`, `404`, `409`, `500`), and JSON response envelopes.
2. **Deterministic Test Execution:** Zero-latency and deterministic pseudo-random seed mode for automated tests (`process.env.TEST_MODE === "true"`), ensuring 100% reproducible test suites.
3. **Controllable Latency & Failure Simulation:** Configurable latency injection (200ms–1,200ms default) and developer controls (`X-Mock-*` headers / query params) to simulate network timeouts, server crashes, and concurrency conflicts.
4. **Massive Dataset Representation:** Realistic deterministic dataset containing >= 1,000 incident records to rigorously evaluate frontend pagination, search indexing, and rendering efficiency.

### 1.2 Base URL
All API endpoints are served relative to:
```text
/api
```

---

## 2. Shared Data Schemas

### 2.1 Enums & Primitive Structures

```ts
export type IncidentStatus =
  | "triggered"
  | "acknowledged"
  | "investigating"
  | "resolved";

export type IncidentSeverity = "critical" | "high" | "medium" | "low";

export interface UserSummary {
  id: string;          // e.g. "usr-12"
  name: string;        // e.g. "Maya Chen"
  email: string;       // e.g. "maya@example.com"
  avatarUrl?: string;  // optional image URL
}

export interface IncidentNote {
  id: string;          // e.g. "note-91"
  incidentId: string;  // references Incident.id, e.g. "INC-1042"
  author: UserSummary;
  message: string;     // Plain-text message content
  createdAt: string;   // ISO 8601 UTC timestamp
}

export interface Incident {
  id: string;                    // e.g. "INC-1042"
  title: string;                 // 5 to 120 chars
  description: string;           // 20 to 2000 chars
  status: IncidentStatus;
  severity: IncidentSeverity;
  service: string;               // e.g. "payments-api"
  assignee: UserSummary | null;
  createdAt: string;             // ISO 8601 UTC timestamp
  updatedAt: string;             // ISO 8601 UTC timestamp
  version: number;               // Monotonic integer revision counter
  notes: IncidentNote[];
}
```

### 2.2 Standard Error Response Envelope

All error responses return `Content-Type: application/json` matching the structure:

```json
{
  "code": "STRING_ERROR_CODE",
  "message": "Human-readable message explaining the failure.",
  "fieldErrors": {
    "title": ["Title must contain at least 5 characters."]
  },
  "currentVersion": 8
}
```

| Field | Type | Mandatory? | Description |
|---|---|---|---|
| `code` | string | **YES** | Standardized error code identifier (e.g. `VALIDATION_ERROR`, `INCIDENT_NOT_FOUND`, `INCIDENT_VERSION_CONFLICT`) |
| `message` | string | **YES** | Human-readable explanation suitable for display in alert banners or logs |
| `fieldErrors` | `Record<string, string[]>` | NO | Map of field names to array of validation error messages (present on `400 Bad Request`) |
| `currentVersion` | number | NO | The current server-side version counter of the entity (present on `409 Conflict`) |

---

## 3. Endpoints Specification

### 3.1 List Incidents
Returns a paginated, filtered, and sorted list of incidents.

```http
GET /api/incidents
```

#### Query Parameters

| Parameter | Type | Required | Default | Example | Description |
|---|---|---|---|---|---|
| `q` | string | No | `""` | `database` | Substring match against `id`, `title`, `service`, and `assignee.name` (case-insensitive). |
| `status` | string | No | `""` | `triggered,investigating` | Comma-separated list of `IncidentStatus`. Records matching ANY of the specified statuses are included. If omitted, all statuses match. |
| `severity` | string | No | `""` | `critical,high` | Comma-separated list of `IncidentSeverity`. Records matching ANY of the specified severities are included. If omitted, all severities match. |
| `service` | string | No | `""` | `payments-api,checkout-web` | Comma-separated list of services. Records matching ANY of the specified services are included. If omitted, all services match. |
| `sort` | string | No | `updatedAt` | `severity` | Sort attribute: `updatedAt`, `createdAt`, or `severity`. |
| `order` | string | No | `desc` | `asc` | Sort direction: `desc` (descending) or `asc` (ascending). |
| `page` | integer | No | `1` | `2` | 1-indexed page number. If `< 1`, treated as `1`. |
| `pageSize` | integer | No | `25` | `50` | Records per page. Allowed values: `10`, `25`, `50`, `100`. Values `> 100` are clamped to `100`. Values `< 1` are clamped to `10`. |

#### Response Envelope: `200 OK`

```json
{
  "items": [
    {
      "id": "INC-1042",
      "title": "Elevated payment failure rate",
      "description": "Payment authorization failures are above the normal threshold.",
      "status": "investigating",
      "severity": "critical",
      "service": "payments-api",
      "assignee": {
        "id": "usr-12",
        "name": "Maya Chen",
        "email": "maya@example.com"
      },
      "createdAt": "2026-08-01T08:42:00.000Z",
      "updatedAt": "2026-08-01T09:18:00.000Z",
      "version": 3,
      "notes": []
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 1043,
  "totalPages": 42
}
```

#### Pagination Calculation Rules:
- `total`: Count of incidents satisfying all active `q`, `status`, `severity`, and `service` criteria.
- `totalPages`: `total === 0 ? 1 : Math.ceil(total / pageSize)`.
- If `page > totalPages`, `items` is returned as an empty array `[]` with accurate `total` and `totalPages`.

---

### 3.2 Get Incident by ID
Retrieves the complete incident record, including its chronological investigation notes.

```http
GET /api/incidents/:incidentId
```

#### Path Parameters
- `incidentId` (string, required): The unique identifier of the incident (e.g. `INC-1042`).

#### Response: `200 OK`

```json
{
  "id": "INC-1042",
  "title": "Elevated payment failure rate",
  "description": "Payment authorization failures are above the normal threshold.",
  "status": "investigating",
  "severity": "critical",
  "service": "payments-api",
  "assignee": {
    "id": "usr-12",
    "name": "Maya Chen",
    "email": "maya@example.com"
  },
  "createdAt": "2026-08-01T08:42:00.000Z",
  "updatedAt": "2026-08-01T09:18:00.000Z",
  "version": 3,
  "notes": [
    {
      "id": "note-91",
      "incidentId": "INC-1042",
      "author": {
        "id": "usr-4",
        "name": "Daniel Brooks",
        "email": "daniel@example.com"
      },
      "message": "The issue appears isolated to the EU payment provider.",
      "createdAt": "2026-08-01T09:02:00.000Z"
    }
  ]
}
```

#### Response: `404 Not Found`

```json
{
  "code": "INCIDENT_NOT_FOUND",
  "message": "The requested incident does not exist."
}
```

---

### 3.3 Create Incident
Creates a new incident record.

```http
POST /api/incidents
Content-Type: application/json
```

#### Request Body Schema

```json
{
  "title": "Checkout latency increased",
  "description": "The 95th percentile latency has exceeded the alert threshold.",
  "status": "triggered",
  "severity": "high",
  "service": "checkout-web",
  "assigneeId": "usr-18"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `title` | string | **YES** | 5 to 120 characters after trimming. |
| `description` | string | **YES** | 20 to 2,000 characters after trimming. |
| `status` | string | **YES** | Must be one of `triggered`, `acknowledged`, `investigating`. Initializing directly as `resolved` is strictly disallowed. |
| `severity` | string | **YES** | Must be one of `critical`, `high`, `medium`, `low`. |
| `service` | string | **YES** | Must be a recognized service string from `GET /api/services`. |
| `assigneeId` | string \| null | NO | Optional. Must match a valid user ID from `GET /api/users` if provided. |

#### Response: `201 Created`
Returns the full created incident with generated ID, timestamps, version `1`, and empty `notes: []`.

```json
{
  "id": "INC-1044",
  "title": "Checkout latency increased",
  "description": "The 95th percentile latency has exceeded the alert threshold.",
  "status": "triggered",
  "severity": "high",
  "service": "checkout-web",
  "assignee": {
    "id": "usr-18",
    "name": "Omar Hassan",
    "email": "omar@example.com"
  },
  "createdAt": "2026-08-01T10:00:00.000Z",
  "updatedAt": "2026-08-01T10:00:00.000Z",
  "version": 1,
  "notes": []
}
```

#### Response: `400 Bad Request` (Validation Error)

```json
{
  "code": "VALIDATION_ERROR",
  "message": "The submitted incident is invalid.",
  "fieldErrors": {
    "title": ["Title must contain at least 5 characters."],
    "description": ["Description must contain at least 20 characters."],
    "service": ["Service is required."],
    "status": ["Incident cannot be created directly in resolved status."]
  }
}
```

---

### 3.4 Update Incident Status
Transitions an incident to a new lifecycle status with optional optimistic concurrency version validation.

```http
PATCH /api/incidents/:incidentId/status
Content-Type: application/json
```

#### Request Body Schema

```json
{
  "status": "resolved",
  "version": 7
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `status` | string | **YES** | Target `IncidentStatus`. Must be a valid lifecycle transition from current status per Functional Spec Section 3.2. |
| `version` | number | NO | The client's currently known version number of the incident. |

#### Response: `200 OK`

```json
{
  "id": "INC-1042",
  "status": "resolved",
  "updatedAt": "2026-08-01T10:04:00.000Z",
  "version": 8
}
```

#### Response: `400 Bad Request` (Invalid Transition)

```json
{
  "code": "INVALID_TRANSITION",
  "message": "Cannot transition incident directly from 'triggered' to 'resolved'."
}
```

#### Response: `409 Conflict` (Version Conflict)
Triggered when the client supplies a `version` less than the server's current version counter:

```json
{
  "code": "INCIDENT_VERSION_CONFLICT",
  "message": "The incident was changed by another user.",
  "currentVersion": 8
}
```

#### Response: `404 Not Found`

```json
{
  "code": "INCIDENT_NOT_FOUND",
  "message": "The requested incident does not exist."
}
```

---

### 3.5 Assign Incident Owner
Updates the incident assignee or unassigns ownership.

```http
PATCH /api/incidents/:incidentId/assignee
Content-Type: application/json
```

#### Request Body Schema

```json
{
  "assigneeId": "usr-12"
}
```
*To unassign, pass:*
```json
{
  "assigneeId": null
}
```

#### Response: `200 OK`
Returns the full updated `Incident` object, with incremented `version` and updated `updatedAt`.

```json
{
  "id": "INC-1042",
  "title": "Elevated payment failure rate",
  "description": "Payment authorization failures are above the normal threshold.",
  "status": "investigating",
  "severity": "critical",
  "service": "payments-api",
  "assignee": {
    "id": "usr-12",
    "name": "Maya Chen",
    "email": "maya@example.com"
  },
  "createdAt": "2026-08-01T08:42:00.000Z",
  "updatedAt": "2026-08-01T10:08:00.000Z",
  "version": 9,
  "notes": []
}
```

#### Response: `400 Bad Request`
Triggered if `assigneeId` is a non-null string that does not correspond to any known user:

```json
{
  "code": "USER_NOT_FOUND",
  "message": "The specified assignee does not exist."
}
```

#### Response: `404 Not Found`

```json
{
  "code": "INCIDENT_NOT_FOUND",
  "message": "The requested incident does not exist."
}
```

---

### 3.6 Add Investigation Note
Appends a chronological investigation note to the incident.

```http
POST /api/incidents/:incidentId/notes
Content-Type: application/json
```

#### Request Body Schema

```json
{
  "message": "Restarted the affected worker pool and error rates are recovering."
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `message` | string | **YES** | 1 to 5,000 characters. Cannot be empty or whitespace-only. |

#### Response: `201 Created`

```json
{
  "id": "note-102",
  "incidentId": "INC-1042",
  "author": {
    "id": "usr-current",
    "name": "Current User",
    "email": "current.user@example.com"
  },
  "message": "Restarted the affected worker pool and error rates are recovering.",
  "createdAt": "2026-08-01T10:12:00.000Z"
}
```

#### Response: `400 Bad Request`

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Investigation note cannot be empty or whitespace-only.",
  "fieldErrors": {
    "message": ["Note message cannot be empty."]
  }
}
```

#### Response: `404 Not Found`

```json
{
  "code": "INCIDENT_NOT_FOUND",
  "message": "The requested incident does not exist."
}
```

---

### 3.7 List Users
Returns a directory of operators available for incident assignment.

```http
GET /api/users
```

#### Response: `200 OK`

```json
{
  "items": [
    {
      "id": "usr-12",
      "name": "Maya Chen",
      "email": "maya@example.com"
    },
    {
      "id": "usr-18",
      "name": "Omar Hassan",
      "email": "omar@example.com"
    },
    {
      "id": "usr-4",
      "name": "Daniel Brooks",
      "email": "daniel@example.com"
    },
    {
      "id": "usr-7",
      "name": "Elena Rostova",
      "email": "elena@example.com"
    }
  ]
}
```

---

### 3.8 List Services
Returns a list of monitored microservices and platform components.

```http
GET /api/services
```

#### Response: `200 OK`

```json
{
  "items": [
    "auth-gateway",
    "checkout-web",
    "identity-service",
    "inventory-service",
    "notification-worker",
    "payments-api",
    "reporting-api",
    "search-indexer"
  ]
}
```

---

### 3.9 Optional Real-Time Event Stream (SSE)
Server-Sent Events endpoint streaming real-time operational updates across all connected operators.

```http
GET /api/incidents/events
Accept: text/event-stream
```

#### Response Headers
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

#### Supported Event Types
1. `incident.created`
2. `incident.updated`
3. `incident.assigned`
4. `incident.note_added`

#### Event Payload Example

```text
event: incident.updated
data: {"type":"incident.updated","incident":{"id":"INC-1042","status":"resolved","updatedAt":"2026-08-01T10:04:00.000Z","version":8}}

```

---

## 4. Mock Server Behavioral Requirements

### 4.1 Latency Simulation
- **Default Production / Dev Mode:** Every simulated endpoint request must artificially delay execution with a uniformly distributed random latency between **200ms** and **1,200ms**:
  $$\text{Delay} = \text{floor}(\text{random}() \times (1200 - 200 + 1)) + 200$$
- **Test Mode Override:** When `NODE_ENV === "test"` or `process.env.TEST_MODE === "true"`, the simulated delay is forced to **0ms** (or an explicit configurable fixture delay) to ensure lightning-fast, reproducible tests.

### 4.2 Controllable Failure Injection
The Mock Server must support deterministic fault injection via HTTP request headers or URL query parameters:

| Header | Query Parameter | Values | Behavior |
|---|---|---|---|
| `X-Mock-Failure` | `__mock_failure` | `500` | Return HTTP `500 Internal Server Error` with `{"code": "INTERNAL_SERVER_ERROR", "message": "Simulated server failure."}` |
| `X-Mock-Failure` | `__mock_failure` | `400` | Return HTTP `400 Bad Request` with `{"code": "VALIDATION_ERROR", "message": "Simulated client error."}` |
| `X-Mock-Failure` | `__mock_failure` | `404` | Return HTTP `404 Not Found` with `{"code": "INCIDENT_NOT_FOUND", "message": "Simulated not found."}` |
| `X-Mock-Failure` | `__mock_failure` | `409` | Return HTTP `409 Conflict` with `{"code": "INCIDENT_VERSION_CONFLICT", "message": "Simulated concurrency conflict.", "currentVersion": 999}` |
| `X-Mock-Failure` | `__mock_failure` | `timeout` | Hang request for 15 seconds to trigger client `AbortSignal.timeout(10000)` |
| `X-Mock-Failure` | `__mock_failure` | `network-error` | Abruptly reset connection / throw unhandled fetch error |
| `X-Mock-Delay` | `__mock_delay` | `<integer_ms>` | Overrides default latency with explicit millisecond duration (e.g. `X-Mock-Delay: 3000`) |
| `X-Mock-Conflict` | `__mock_conflict` | `true` | Specifically forces `409 Conflict` on `PATCH /api/incidents/:id/status` |

*Security Constraint: In production deployments, mock failure controls must either be disabled or restricted to a dedicated non-production demo toggle.*

---

## 5. Deterministic Dataset Generation (1,000+ Incidents)

To satisfy performance acceptance criteria, the Mock Server initializes an in-memory database of **at least 1,000 incident records** generated deterministically using a seeded Pseudo-Random Number Generator (PRNG).

### 5.1 Seeded PRNG Specification
A deterministic Mulberry32 generator ensures identical data across server restarts and test runs:

```ts
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x41544c41; // "ATLA"
const rng = mulberry32(SEED);
```

### 5.2 Fixture Distributions & Generation Parameters

1. **Total Records:** Exactly **1,048 incidents** (`INC-1001` through `INC-2048`).
2. **Service Allocation:**
   - `payments-api`: 20%
   - `checkout-web`: 20%
   - `identity-service`: 15%
   - `notification-worker`: 15%
   - `reporting-api`: 10%
   - `auth-gateway`: 10%
   - `inventory-service`: 10%
3. **Severity Allocation:**
   - `critical`: 10% (~105 incidents)
   - `high`: 25% (~262 incidents)
   - `medium`: 40% (~419 incidents)
   - `low`: 25% (~262 incidents)
4. **Status Allocation:**
   - `triggered`: 15%
   - `acknowledged`: 25%
   - `investigating`: 35%
   - `resolved`: 25%
5. **Assignee Allocation:**
   - Assigned to one of 10 mock users: 80%
   - Unassigned (`null`): 20%
6. **Timestamps:**
   - Distributed smoothly over the past 60 days relative to fixed base timestamp `2026-08-01T12:00:00.000Z` or runtime anchor.
   - `createdAt` generated first; `updatedAt` generated as `createdAt + random(5 minutes, 36 hours)`.
7. **Notes:**
   - Each incident contains between 0 and 6 deterministic notes generated from a realistic operations phrase bank (e.g. *"Investigating worker queue depth"*, *"Rolled back canary deployment"*, *"Database connection pool saturated"*).

---

## 6. Standalone Execution, Health Check & Submission Architecture

Per `SUBMISSION.md`, the mock backend must operate as a standalone, production-ready server suitable for clean-checkout evaluation and independent deployment.

### 6.1 Server Health Check Endpoint
- **URL:** `GET /health`
- **Authentication:** None
- **Response Status:** `200 OK`
- **Response Schema:**
  ```json
  {
    "status": "ok",
    "uptime": 142.5,
    "timestamp": "2026-10-05T14:30:00.000Z",
    "version": "1.0.0",
    "totalIncidents": 1048
  }
  ```

### 6.2 Standalone Execution & CORS
1. **Port & Environment Variables:** Listens on port `3001` by default, configurable via `PORT` (`process.env.PORT || 3001`).
2. **CORS Middleware:** Automatically includes permissive CORS headers (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type, X-Mock-Failure, X-Mock-Delay, X-Mock-Conflict`, `Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS`).
3. **5-Command Lifecycle Compliance:**
   ```bash
   npm install      # Installs all server dependencies
   npm run dev      # Starts standalone Node/Express server on port 3001 with hot reload
   npm test         # Executes Vitest suite with 0ms latency and test fixtures
   npm run build    # Compiles TypeScript into standalone dist/
   npm run start    # Runs compiled server in production mode
   ```
4. **Self-Contained Isolation:** The `backend/` repository contains its own contracts, tests, configs, and candidate `README.md` with zero dependencies on parent directories.

---
*End of REST API & Mock Specification*

