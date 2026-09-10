// Google ID token verification, JWKS fetch + KV cache, our own session token sign/verify — AUTH.md §3.1, §6; MODULES.md "KV keyspace ownership" (jwks:*)

import type { Context } from "hono"
import { setCookie, deleteCookie } from "hono/cookie"
import { SignJWT, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose"
import {
  GOOGLE_ISSUERS,
  GOOGLE_JWKS_CACHE_KEY,
  GOOGLE_JWKS_URL,
  JWKS_FALLBACK_CACHE_TTL_SEC,
  JWT_CLOCK_TOLERANCE_SEC,
  MIN_SESSION_SIGNING_KEY_BYTES,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SEC,
} from "../core/config"

export class GoogleTokenError extends Error {
  constructor(readonly reason: string) {
    super(`google id token rejected: ${reason}`)
    this.name = "GoogleTokenError"
  }
}

export class SessionTokenError extends Error {
  constructor(readonly reason: string) {
    super(`session token rejected: ${reason}`)
    this.name = "SessionTokenError"
  }
}

export type VerifiedGoogleIdentity = {
  sub: string
  email: string
  name: string
  pictureUrl: string | null
}

export type GoogleVerifyDeps = {
  fetchImpl: typeof fetch
  now: () => number // epoch seconds
  kv: KVNamespace
  clientId: string
}

type CachedJwks = { keys: JWK[] }

function parseMaxAgeSeconds(cacheControl: string | null): number | null {
  const match = cacheControl?.match(/max-age=(\d+)/)
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

async function fetchGoogleJwks(deps: GoogleVerifyDeps): Promise<CachedJwks> {
  let response: Response
  try {
    response = await deps.fetchImpl(GOOGLE_JWKS_URL)
  } catch {
    throw new GoogleTokenError("jwks_fetch_failed")
  }
  if (!response.ok) {
    throw new GoogleTokenError("jwks_fetch_failed")
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new GoogleTokenError("jwks_fetch_failed")
  }
  const keys = (body as { keys?: unknown }).keys
  if (!Array.isArray(keys)) {
    throw new GoogleTokenError("jwks_fetch_failed")
  }
  const jwks: CachedJwks = { keys: keys as JWK[] }

  const ttlSec = parseMaxAgeSeconds(response.headers.get("cache-control")) ?? JWKS_FALLBACK_CACHE_TTL_SEC
  await deps.kv.put(GOOGLE_JWKS_CACHE_KEY, JSON.stringify(jwks), { expirationTtl: ttlSec })

  return jwks
}

async function readCachedJwks(deps: GoogleVerifyDeps): Promise<CachedJwks | null> {
  const raw = await deps.kv.get(GOOGLE_JWKS_CACHE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CachedJwks
  } catch {
    return null
  }
}

function findKey(jwks: CachedJwks, kid: string | undefined): JWK | undefined {
  if (!kid) return undefined
  return jwks.keys.find((key) => key.kid === kid)
}

async function resolveGoogleSigningKey(kid: string | undefined, deps: GoogleVerifyDeps) {
  const cached = await readCachedJwks(deps)
  const cachedMatch = cached ? findKey(cached, kid) : undefined
  if (cachedMatch) return importJWK(cachedMatch, "RS256")

  // Unknown/missing kid (or no cache yet): force exactly one fresh fetch, then give up.
  const fresh = await fetchGoogleJwks(deps)
  const freshMatch = findKey(fresh, kid)
  if (!freshMatch) throw new GoogleTokenError("unknown_kid")
  return importJWK(freshMatch, "RS256")
}

export async function verifyGoogleIdToken(
  idToken: string,
  deps: GoogleVerifyDeps
): Promise<VerifiedGoogleIdentity> {
  let header: { alg?: string; kid?: string }
  try {
    header = decodeProtectedHeader(idToken)
  } catch {
    throw new GoogleTokenError("malformed")
  }
  if (header.alg !== "RS256") {
    throw new GoogleTokenError("unexpected_algorithm")
  }

  const key = await resolveGoogleSigningKey(header.kid, deps)

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(idToken, key, {
      algorithms: ["RS256"],
      issuer: [...GOOGLE_ISSUERS],
      audience: deps.clientId,
      requiredClaims: ["exp", "sub"],
      clockTolerance: JWT_CLOCK_TOLERANCE_SEC,
      currentDate: new Date(deps.now() * 1000),
    })
    payload = result.payload
  } catch (err) {
    if (err instanceof GoogleTokenError) throw err
    throw new GoogleTokenError("invalid_signature_or_claims")
  }

  const sub = payload.sub
  const email = payload.email
  const name = payload.name
  const picture = payload.picture
  const emailVerified = payload.email_verified

  if (typeof sub !== "string" || sub.length === 0) throw new GoogleTokenError("missing_sub")
  if (typeof email !== "string" || email.length === 0) throw new GoogleTokenError("missing_email")
  if (typeof name !== "string" || name.length === 0) throw new GoogleTokenError("missing_name")
  if (emailVerified !== true) throw new GoogleTokenError("email_not_verified")

  return {
    sub,
    email,
    name,
    pictureUrl: typeof picture === "string" && picture.length > 0 ? picture : null,
  }
}

// ============================================================================
// Quizzer session — HS256, payload is exactly { uid, iat, exp }.
// ============================================================================

export type SessionClaims = { uid: string; iat: number; exp: number }

function sessionSigningSecret(signingKey: string): Uint8Array {
  const bytes = new TextEncoder().encode(signingKey)
  if (bytes.length < MIN_SESSION_SIGNING_KEY_BYTES) {
    throw new SessionTokenError("weak_signing_key")
  }
  return bytes
}

export async function signSession(uid: string, signingKey: string, now: () => number): Promise<string> {
  const secret = sessionSigningSecret(signingKey)
  const iat = Math.floor(now())
  const exp = iat + SESSION_TTL_SEC
  return new SignJWT({ uid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret)
}

export async function verifySession(
  token: string,
  signingKey: string,
  now: () => number
): Promise<SessionClaims> {
  const secret = sessionSigningSecret(signingKey)

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      requiredClaims: ["uid", "iat", "exp"],
      currentDate: new Date(now() * 1000),
    })
    payload = result.payload
  } catch (err) {
    if (err instanceof SessionTokenError) throw err
    throw new SessionTokenError("invalid_signature_or_expired")
  }

  const uid = payload.uid
  const iat = payload.iat
  const exp = payload.exp
  if (typeof uid !== "string" || uid.length === 0) throw new SessionTokenError("malformed_claims")
  if (typeof iat !== "number" || typeof exp !== "number") throw new SessionTokenError("malformed_claims")

  return { uid, iat, exp }
}

// ============================================================================
// Cookie policy — one place decides the attributes for every set/clear.
// ============================================================================

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  })
}
