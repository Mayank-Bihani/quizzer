// V1 constants: seat cap 120, room-code format, UNIT_SUBMISSION_TRANSPORT_MS=5000; positive unit allowances and configurable transition slack — PRD.md; QUIZZING.md §4-5.

import type { CurrentUser } from "./contracts"

// ============================================================================
// Worker environment — extended additively by later sprints.
// ============================================================================

export type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  IMAGES: R2Bucket
  GOOGLE_CLIENT_ID: string
  SESSION_SIGNING_KEY: string
  SUPERADMIN_EMAIL: string
}

export type Variables = {
  currentUser: CurrentUser
}

// ============================================================================
// AUTH — AUTH.md §3, §6
// ============================================================================

export const SESSION_COOKIE_NAME = "quizzer_session"
export const SESSION_TTL_SEC = 2_592_000 // 30 days — AUTH.md §6, resolved 2026-09-05
export const SESSION_JWT_ALGORITHM = "HS256"
export const MIN_SESSION_SIGNING_KEY_BYTES = 32

export const GOOGLE_JWT_ALGORITHM = "RS256"
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
export const GOOGLE_JWKS_CACHE_KEY = "jwks:google"
// Used when Google's Cache-Control response header is missing or unparseable.
export const JWKS_FALLBACK_CACHE_TTL_SEC = 3600
export const JWT_CLOCK_TOLERANCE_SEC = 60

// A Google ID token is a few KB at most; this bounds the parsed request body defensively.
export const MAX_GOOGLE_SIGNIN_BODY_BYTES = 8192

// ============================================================================
// BANK — upload policy resolved 2026-09-10 (BANK.md §7); pagination is the global
// convention shared by every list route that can grow without bound (API.md).
// ============================================================================

export const MAX_CSV_BYTES = 5 * 1024 * 1024
export const MAX_ZIP_BYTES = 20 * 1024 * 1024 // as uploaded
export const MAX_ZIP_INFLATED_BYTES = 50 * 1024 * 1024 // after unzip
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // per image
export const ALLOWED_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 100

// D1 batch() has undocumented statement/size limits; this keeps each chunk comfortably bounded.
export const IMPORT_BATCH_ROWS = 50

export const IMAGES_ROUTE_PREFIX = "/api/images"
