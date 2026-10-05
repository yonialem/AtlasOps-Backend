import {
  Incident,
  IncidentSchema,
  IncidentSeverity,
  IncidentStatus,
  IncidentNote,
  UserSummary,
} from "../contracts/index.ts";

/**
 * ============================================================================
 * AtlasOps Incident Management Console - Deterministic Seed Generator
 * ============================================================================
 * Uses the Mulberry32 32-bit PRNG seeded at 0x41544c41 ("ATLA") to synthesize
 * exactly 1,048 bit-for-bit reproducible, contract-compliant incident records.
 */

export const DEFAULT_SEED = 0x41544c41; // ASCII "ATLA" (1096043585)
export const SEED_INCIDENT_COUNT = 1048;

// ----------------------------------------------------------------------------
// 1. Mulberry32 32-bit Seeded PRNG
// ----------------------------------------------------------------------------

export function createMulberry32(seed: number = DEFAULT_SEED): () => number {
  let s = seed >>> 0;
  return function next(): number {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------------------------
// 2. Monitored Services & User Directory
// ----------------------------------------------------------------------------

export const MOCK_SERVICES = [
  "payments-api",
  "checkout-web",
  "identity-service",
  "notification-worker",
  "reporting-api",
  "auth-gateway",
  "inventory-service",
] as const;

export const SEED_SERVICES = MOCK_SERVICES;

export function getSeedServices(): string[] {
  return [...MOCK_SERVICES];
}

export const MOCK_USERS: readonly UserSummary[] = [
  { id: "usr-1", name: "Maya Chen", email: "maya.chen@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Maya" },
  { id: "usr-2", name: "Daniel Brooks", email: "daniel.brooks@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Daniel" },
  { id: "usr-3", name: "Elena Rostova", email: "elena.rostova@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Elena" },
  { id: "usr-4", name: "Omar Hassan", email: "omar.hassan@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Omar" },
  { id: "usr-5", name: "Sarah Jenkins", email: "sarah.jenkins@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah" },
  { id: "usr-6", name: "Alex Rivera", email: "alex.rivera@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alex" },
  { id: "usr-7", name: "Priya Sharma", email: "priya.sharma@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Priya" },
  { id: "usr-8", name: "Marcus Vance", email: "marcus.vance@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus" },
  { id: "usr-9", name: "Chloe Dupont", email: "chloe.dupont@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Chloe" },
  { id: "usr-10", name: "Liam O'Connor", email: "liam.oconnor@atlasops.io", avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Liam" },
] as const;

export const SEED_USERS = MOCK_USERS;

export function getSeedUsers(): UserSummary[] {
  return [...MOCK_USERS];
}

// ----------------------------------------------------------------------------
// 3. Phrase Banks & Synthesis Templates
// ----------------------------------------------------------------------------

const TITLE_TEMPLATES: readonly string[] = [
  "{service} p99 latency spiked above threshold ({latency}ms)",
  "Elevated payment authorization failure rate in {region}",
  "Database connection pool exhaustion on {service}",
  "Cascading 504 gateway timeout on {service} ingress",
  "Worker queue backlog exceeded {count} pending tasks",
  "Memory leak detected in {service} canary cluster",
  "TLS certificate expiration warning for {service} endpoints",
  "Deadlock detected during batch settlement run",
];

const REGIONS: readonly string[] = ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"];

const NOTE_PHRASES: readonly string[] = [
  "Initial alert triggered via PagerDuty webhook. Triage initiated.",
  "Investigating worker thread pool depth and database connection contention.",
  "Isolated issue to EU gateway region; US and APAC traffic unaffected.",
  "Rolled back canary deployment v2.14.1 to restore baseline throughput.",
  "Increased max connection pool size from 100 to 250; error rates dropping.",
  "Upstream third-party payment provider confirmed degraded API performance.",
  "Service metrics stabilized. Monitoring error budget burn rate.",
  "Incident mitigated. Moving to post-incident review and root-cause analysis.",
];

// ----------------------------------------------------------------------------
// 4. Statistical Distribution Selectors
// ----------------------------------------------------------------------------

function pickService(val: number): string {
  // payments-api (20%), checkout-web (20%), identity-service (15%), notification-worker (15%), reporting-api (10%), auth-gateway (10%), inventory-service (10%)
  if (val < 0.20) return "payments-api";
  if (val < 0.40) return "checkout-web";
  if (val < 0.55) return "identity-service";
  if (val < 0.70) return "notification-worker";
  if (val < 0.80) return "reporting-api";
  if (val < 0.90) return "auth-gateway";
  return "inventory-service";
}

function pickSeverity(val: number): IncidentSeverity {
  // critical (10%), high (25%), medium (40%), low (25%)
  if (val < 0.10) return "critical";
  if (val < 0.35) return "high";
  if (val < 0.75) return "medium";
  return "low";
}

function pickStatus(val: number): IncidentStatus {
  // triggered (15%), acknowledged (25%), investigating (35%), resolved (25%)
  if (val < 0.15) return "triggered";
  if (val < 0.40) return "acknowledged";
  if (val < 0.75) return "investigating";
  return "resolved";
}

function pickAssignee(val: number, userVal: number): UserSummary | null {
  // 80% assigned to one of MOCK_USERS, 20% unassigned (null)
  if (val < 0.20) return null;
  const index = Math.floor(userVal * MOCK_USERS.length);
  return MOCK_USERS[Math.min(index, MOCK_USERS.length - 1)];
}

// ----------------------------------------------------------------------------
// 5. Seed Generator Implementation
// ----------------------------------------------------------------------------

export function generateSeedIncidents(seed: number = DEFAULT_SEED): Incident[] {
  const rng = createMulberry32(seed);
  const incidents: Incident[] = [];

  const ANCHOR_TIME_MS = Date.parse("2026-08-01T12:00:00.000Z");
  const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;

  for (let idNum = 1001; idNum <= 1001 + SEED_INCIDENT_COUNT - 1; idNum++) {
    const id = `INC-${idNum}`;
    const service = pickService(rng());
    const severity = pickSeverity(rng());
    const status = pickStatus(rng());
    const assignee = pickAssignee(rng(), rng());

    // Synthesize title
    const templateIndex = Math.floor(rng() * TITLE_TEMPLATES.length);
    const template = TITLE_TEMPLATES[Math.min(templateIndex, TITLE_TEMPLATES.length - 1)];
    const latency = Math.floor(250 + rng() * 1500);
    const region = REGIONS[Math.floor(rng() * REGIONS.length)];
    const count = Math.floor(1000 + rng() * 50000);
    const title = template
      .replace("{service}", service)
      .replace("{latency}", latency.toString())
      .replace("{region}", region)
      .replace("{count}", count.toString());

    // Generate timestamps
    const createdAtOffset = Math.floor(rng() * SIXTY_DAYS_MS);
    const createdAtMs = ANCHOR_TIME_MS - createdAtOffset;
    const updateDeltaMs = Math.floor(FIVE_MINUTES_MS + rng() * (THIRTY_SIX_HOURS_MS - FIVE_MINUTES_MS));
    const updatedAtMs = createdAtMs + updateDeltaMs;

    const createdAt = new Date(createdAtMs).toISOString();
    const updatedAt = new Date(updatedAtMs).toISOString();

    // Notes: 0 to 6 notes uniformly
    const notesCount = Math.floor(rng() * 7);
    const notes: IncidentNote[] = [];
    for (let k = 0; k < notesCount; k++) {
      const noteTimeMs = createdAtMs + Math.floor(((k + 1) / (notesCount + 1)) * updateDeltaMs);
      const noteAuthorIndex = Math.floor(rng() * MOCK_USERS.length);
      const noteAuthor = MOCK_USERS[Math.min(noteAuthorIndex, MOCK_USERS.length - 1)];
      const notePhraseIndex = Math.floor(rng() * NOTE_PHRASES.length);
      const noteMessage = NOTE_PHRASES[Math.min(notePhraseIndex, NOTE_PHRASES.length - 1)];

      notes.push({
        id: `note-${idNum}-${k + 1}`,
        incidentId: id,
        author: noteAuthor,
        message: noteMessage,
        createdAt: new Date(noteTimeMs).toISOString(),
      });
    }

    // Initial version: 1
    const version = 1;

    // Realistic description meeting length requirements (>= 20 chars)
    const description = `Automated telemetry detected ${severity} operational anomalies on ${service}. ${title}. The incident team responded to investigate systemic impact and protect service level objectives.`;

    const incident: Incident = {
      id,
      title,
      description,
      status,
      severity,
      service,
      assignee,
      createdAt,
      updatedAt,
      version,
      notes,
    };

    // Strict validation against authoritative contract schema
    IncidentSchema.parse(incident);
    incidents.push(incident);
  }

  return incidents;
}

/**
 * Resets and returns a fresh copy of the seed incidents.
 */
export function resetSeed(seed: number = DEFAULT_SEED): Incident[] {
  return generateSeedIncidents(seed);
}
