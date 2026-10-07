# Mock API Contract

You may implement this API using:

- Mock Service Worker.
- A small local Node.js server.
- Framework route handlers.
- JSON Server with custom behavior.
- Another deterministic mock implementation.

The frontend must not depend on private company infrastructure.

## Base URL

```text
/api
```

## General Response Behavior

The API should simulate:

- Latency between 200ms and 1,200ms.
- Occasional failures.
- Deterministic test behavior.
- At least 1,000 incident records for performance testing.

For automated tests, disable random failures and use deterministic fixtures.

## 1. List Incidents

```http
GET /api/incidents
```

### Query Parameters

| Parameter | Example | Description |
|---|---|---|
| `q` | `database` | Search term |
| `status` | `triggered,investigating` | Comma-separated statuses |
| `severity` | `critical,high` | Comma-separated severities |
| `service` | `payments-api` | Service filter |
| `sort` | `updatedAt` | Sort field |
| `order` | `desc` | Sort direction |
| `page` | `1` | Page number |
| `pageSize` | `25` | Records per page |

### Response

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
      "notes": []
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 1043,
  "totalPages": 42
}
```

## 2. Get Incident

```http
GET /api/incidents/:incidentId
```

### Successful Response

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

### Not Found

```http
404 Not Found
```

```json
{
  "code": "INCIDENT_NOT_FOUND",
  "message": "The requested incident does not exist."
}
```

## 3. Create Incident

```http
POST /api/incidents
Content-Type: application/json
```

### Request

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

### Response

```http
201 Created
```

Returns the created incident.

### Validation Error

```http
400 Bad Request
```

```json
{
  "code": "VALIDATION_ERROR",
  "message": "The submitted incident is invalid.",
  "fieldErrors": {
    "title": ["Title must contain at least 5 characters."]
  }
}
```

## 4. Update Incident Status

```http
PATCH /api/incidents/:incidentId/status
Content-Type: application/json
```

### Request

```json
{
  "status": "resolved",
  "version": 7
}
```

The optional `version` field may be used to demonstrate conflict handling.

### Success

```json
{
  "id": "INC-1042",
  "status": "resolved",
  "updatedAt": "2026-08-01T10:04:00.000Z",
  "version": 8
}
```

### Conflict

```http
409 Conflict
```

```json
{
  "code": "INCIDENT_VERSION_CONFLICT",
  "message": "The incident was changed by another user.",
  "currentVersion": 8
}
```

## 5. Assign Incident

```http
PATCH /api/incidents/:incidentId/assignee
Content-Type: application/json
```

### Assign

```json
{
  "assigneeId": "usr-12"
}
```

### Unassign

```json
{
  "assigneeId": null
}
```

### Response

Returns the updated incident.

## 6. Add Note

```http
POST /api/incidents/:incidentId/notes
Content-Type: application/json
```

### Request

```json
{
  "message": "Restarted the affected worker pool and error rates are recovering."
}
```

### Response

```http
201 Created
```

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

## 7. List Users

```http
GET /api/users
```

### Response

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
    }
  ]
}
```

## 8. List Services

```http
GET /api/services
```

### Response

```json
{
  "items": [
    "payments-api",
    "checkout-web",
    "identity-service",
    "notification-worker",
    "reporting-api"
  ]
}
```

## 9. Optional Real-Time Endpoint

```http
GET /api/incidents/events
Accept: text/event-stream
```

Possible events:

```text
incident.created
incident.updated
incident.assigned
incident.note_added
```

Example event:

```json
{
  "type": "incident.updated",
  "incident": {
    "id": "INC-1042",
    "status": "resolved",
    "updatedAt": "2026-08-01T10:04:00.000Z"
  }
}
```

## 10. Suggested Failure Controls

For development convenience, you may support headers or query parameters such as:

```text
X-Mock-Failure: 500
X-Mock-Delay: 3000
X-Mock-Conflict: true
```

Do not expose these controls in production unless clearly marked as development-only.
