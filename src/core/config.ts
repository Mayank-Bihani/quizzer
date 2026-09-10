// V1 constants: seat cap 120, room-code format, UNIT_SUBMISSION_TRANSPORT_MS=5000; positive unit allowances and configurable transition slack — PRD.md; QUIZZING.md §4-5.

import type { BankContract, CloseResult, CurrentUser } from "./contracts"

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
  // Failure-alert channels — SCHEDULER.md §4.1. Unset locally/pre-launch; each channel is
  // attempted independently and a missing binding is just treated as that channel unavailable.
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_ALERT_CHAT_ID?: string
  EMAIL_ALERT_ADDRESS?: string
  ALERT_EMAIL?: SendEmail
  // Student-facing announcement channel — TELEGRAM.md §8. TELEGRAM_ENABLED is the kill switch:
  // off (unset/not "true") in local dev so wrangler dev never posts to a real group.
  TELEGRAM_CHAT_ID?: string
  TELEGRAM_ENABLED?: string
}

export type Variables = {
  currentUser: CurrentUser
  bank: BankContract
  // Locally-typed callback, not Telegram-shaped itself (AC-13) — lets routes/results.ts's lazy
  // close path fire the same post-commit hook the scheduler's close pass uses, composed once in
  // index.ts rather than importing anything Telegram-owned into the route file.
  onQuizClosed?: (quizId: string, result: CloseResult) => Promise<void>
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

// ============================================================================
// QUIZZING creation — PRD.md §"QUIZ-8"; QUIZZING.md §4.
// ============================================================================

export const MAX_GRADED_QUESTION_COUNT = 100
export const MAX_SEAT_CAP = 120

// Human-readable room code, e.g. "QNT-8417" (PRD.md QUIZ-8) — a section prefix plus random digits.
export const ROOM_CODE_PREFIX_BY_TYPE = { verbal: "VRB", quant: "QNT", lr: "LGR" } as const
export const ROOM_CODE_DIGIT_LENGTH = 4
export const ROOM_CODE_MAX_COLLISION_RETRIES = 10

export const QUIZ_NUMBER_MAX_COLLISION_RETRIES = 10

// ============================================================================
// QUIZZING run — PRD.md §5.4; QUIZZING.md §5.
// ============================================================================

// Delivery-only allowance after the edit deadline; never additional editing time.
export const UNIT_SUBMISSION_TRANSPORT_MS = 5000

// Implementation protection, not new product limits.
export const MAX_SUBMISSION_ID_BYTES = 128
export const MAX_UNIT_ANSWERS = 5 // matches the largest legal RC/LRDI group size
export const SEAT_PREP_CHUNK_SIZE = 50

export const SCHEDULER_DISCOVERY_LIMIT = 100
export const CLOSE_ALERT_DELAY_MS = 180_000 // three minutes after safeCloseAt — SCHEDULER.md §4.1
