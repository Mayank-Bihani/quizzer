import { SignJWT, exportJWK, generateKeyPair } from "jose"
import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  GoogleTokenError,
  SessionTokenError,
  clearSessionCookie,
  setSessionCookie,
  signSession,
  verifyGoogleIdToken,
  verifySession,
} from "../src/services/jwt"
import { GOOGLE_JWKS_URL, MIN_SESSION_SIGNING_KEY_BYTES, SESSION_COOKIE_NAME } from "../src/core/config"

const GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com"
const ISSUER = "https://accounts.google.com"
const KID_A = "kid-a"
const KID_B = "kid-b"

async function buildKeyPair() {
  return generateKeyPair("RS256", { extractable: true })
}

async function jwkFor(kid: string, publicKey: CryptoKey) {
  const jwk = await exportJWK(publicKey)
  return { ...jwk, kid, alg: "RS256", use: "sig" }
}

function jwksResponse(jwks: unknown[]) {
  return new Response(JSON.stringify({ keys: jwks }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  })
}

async function signGoogleToken(
  privateKey: CryptoKey,
  kid: string,
  claims: Record<string, unknown>,
  { nowSec = 1_700_000_000, expInSec = 3600 }: { nowSec?: number; expInSec?: number } = {}
) {
  const jwt = new SignJWT({
    email: "student@example.com",
    email_verified: true,
    name: "Test Student",
    picture: "https://example.com/pic.jpg",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt(nowSec)
    .setIssuer(ISSUER)
    .setAudience(GOOGLE_CLIENT_ID)
    .setSubject((claims.sub as string) ?? "google-subject-1")
    .setExpirationTime(nowSec + expInSec)
  return jwt.sign(privateKey)
}

describe("verifyGoogleIdToken", () => {
  let keyA: { publicKey: CryptoKey; privateKey: CryptoKey }
  let keyB: { publicKey: CryptoKey; privateKey: CryptoKey }
  let jwkA: Record<string, unknown>

  beforeEach(async () => {
    keyA = await buildKeyPair()
    keyB = await buildKeyPair()
    jwkA = await jwkFor(KID_A, keyA.publicKey)
    await env.CACHE.delete("jwks:google")
  })

  function deps(fetchImpl: typeof fetch, now = () => 1_700_000_000) {
    return { fetchImpl, now, kv: env.CACHE, clientId: GOOGLE_CLIENT_ID }
  }

  it("accepts a validly signed token and returns the verified identity", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    const token = await signGoogleToken(keyA.privateKey, KID_A, {})

    const identity = await verifyGoogleIdToken(token, deps(fetchImpl))

    expect(identity).toEqual({
      sub: "google-subject-1",
      email: "student@example.com",
      name: "Test Student",
      pictureUrl: "https://example.com/pic.jpg",
    })
  })

  it("accepts a token with no nbf claim", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    const token = await signGoogleToken(keyA.privateKey, KID_A, {})

    await expect(verifyGoogleIdToken(token, deps(fetchImpl))).resolves.toBeDefined()
  })

  it("rejects a token whose nbf is in the future", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    const token = await signGoogleToken(keyA.privateKey, KID_A, { nbf: 1_700_001_000 })

    await expect(verifyGoogleIdToken(token, deps(fetchImpl))).rejects.toThrow(GoogleTokenError)
  })

  it("caches the JWKS and does not refetch on a second call", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    const token = await signGoogleToken(keyA.privateKey, KID_A, {})

    await verifyGoogleIdToken(token, deps(fetchImpl))
    await verifyGoogleIdToken(token, deps(fetchImpl))

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toEqual(expect.stringContaining(GOOGLE_JWKS_URL))
  })

  it("forces exactly one refetch on an unknown kid and recovers if the new key is found", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      // First response only has key A cached; rotation adds key B.
      return call === 1 ? jwksResponse([jwkA]) : jwksResponse([jwkA, await jwkFor(KID_B, keyB.publicKey)])
    })
    // Prime the cache with only key A.
    await verifyGoogleIdToken(await signGoogleToken(keyA.privateKey, KID_A, {}), deps(fetchImpl))
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const rotatedToken = await signGoogleToken(keyB.privateKey, KID_B, {})
    const identity = await verifyGoogleIdToken(rotatedToken, deps(fetchImpl))

    expect(identity.sub).toBe("google-subject-1")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("rejects an unknown kid after the single forced refetch also misses it", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    // Prime the cache with key A so there is a stale cache to miss against.
    await verifyGoogleIdToken(await signGoogleToken(keyA.privateKey, KID_A, {}), deps(fetchImpl))
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const tokenFromUnknownKey = await signGoogleToken(keyB.privateKey, "totally-unknown-kid", {})

    await expect(verifyGoogleIdToken(tokenFromUnknownKey, deps(fetchImpl))).rejects.toThrow(GoogleTokenError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("rejects a token forged with the wrong private key", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    // Signed with key B, but the header claims kid A (whose cached JWK is key A's public key).
    const forged = await signGoogleToken(keyB.privateKey, KID_A, {})

    await expect(verifyGoogleIdToken(forged, deps(fetchImpl))).rejects.toThrow(GoogleTokenError)
  })

  it("rejects an expired token", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    // Beyond the clock-tolerance window, so this is unambiguously expired, not clock skew.
    const token = await signGoogleToken(keyA.privateKey, KID_A, {}, { expInSec: -120 })

    await expect(verifyGoogleIdToken(token, deps(fetchImpl))).rejects.toThrow(GoogleTokenError)
  })

  it("rejects a token with the wrong audience", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    const wrongAudienceDeps = deps(fetchImpl)
    const token = await new SignJWT({
      email: "student@example.com",
      email_verified: true,
      name: "Test Student",
    })
      .setProtectedHeader({ alg: "RS256", kid: KID_A })
      .setIssuedAt(1_700_000_000)
      .setIssuer(ISSUER)
      .setAudience("someone-elses-client-id")
      .setSubject("google-subject-1")
      .setExpirationTime(1_700_003_600)
      .sign(keyA.privateKey)

    await expect(verifyGoogleIdToken(token, wrongAudienceDeps)).rejects.toThrow(GoogleTokenError)
  })

  it("rejects a token with the wrong issuer", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    const token = await new SignJWT({
      email: "student@example.com",
      email_verified: true,
      name: "Test Student",
    })
      .setProtectedHeader({ alg: "RS256", kid: KID_A })
      .setIssuedAt(1_700_000_000)
      .setIssuer("https://not-google.example.com")
      .setAudience(GOOGLE_CLIENT_ID)
      .setSubject("google-subject-1")
      .setExpirationTime(1_700_003_600)
      .sign(keyA.privateKey)

    await expect(verifyGoogleIdToken(token, deps(fetchImpl))).rejects.toThrow(GoogleTokenError)
  })

  it("rejects a token whose email is not verified", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    const token = await signGoogleToken(keyA.privateKey, KID_A, { email_verified: false })

    await expect(verifyGoogleIdToken(token, deps(fetchImpl))).rejects.toThrow(GoogleTokenError)
  })

  it("rejects a malformed token", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))

    await expect(verifyGoogleIdToken("not-a-jwt", deps(fetchImpl))).rejects.toThrow(GoogleTokenError)
  })

  it("never includes the raw token or a stack trace in the thrown error message", async () => {
    const fetchImpl = vi.fn(async () => jwksResponse([jwkA]))
    const secretLookingToken = "not-a-jwt-but-secret-lookingA1b2C3"

    try {
      await verifyGoogleIdToken(secretLookingToken, deps(fetchImpl))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleTokenError)
      expect(String((err as Error).message)).not.toContain(secretLookingToken)
    }
  })
})

describe("session sign/verify", () => {
  const SIGNING_KEY = "a".repeat(MIN_SESSION_SIGNING_KEY_BYTES)
  const nowSec = () => 1_700_000_000

  it("signs a token containing exactly uid, iat, and exp", async () => {
    const token = await signSession("user-1", SIGNING_KEY, nowSec)
    const claims = await verifySession(token, SIGNING_KEY, nowSec)

    expect(claims).toEqual({
      uid: "user-1",
      iat: 1_700_000_000,
      exp: 1_700_000_000 + 2_592_000,
    })
  })

  it("rejects a token verified with the wrong signing key", async () => {
    const token = await signSession("user-1", SIGNING_KEY, nowSec)

    await expect(verifySession(token, "b".repeat(MIN_SESSION_SIGNING_KEY_BYTES), nowSec)).rejects.toThrow(
      SessionTokenError
    )
  })

  it("rejects an expired session token", async () => {
    const token = await signSession("user-1", SIGNING_KEY, nowSec)
    const farFuture = () => nowSec() + 2_592_000 + 3600

    await expect(verifySession(token, SIGNING_KEY, farFuture)).rejects.toThrow(SessionTokenError)
  })

  it("rejects a malformed session token", async () => {
    await expect(verifySession("garbage", SIGNING_KEY, nowSec)).rejects.toThrow(SessionTokenError)
  })

  it("rejects a token signed with an unexpected algorithm", async () => {
    const { SignJWT: RealSignJWT } = await import("jose")
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true })
    const token = await new RealSignJWT({ uid: "user-1" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt(nowSec())
      .setExpirationTime(nowSec() + 2_592_000)
      .sign(privateKey)
    void publicKey

    await expect(verifySession(token, SIGNING_KEY, nowSec)).rejects.toThrow(SessionTokenError)
  })
})

describe("cookie helpers", () => {
  it("sets the session cookie with the exact secure attribute policy", async () => {
    const { Hono } = await import("hono")
    const app = new Hono()
    app.get("/set", (c) => {
      setSessionCookie(c, "token-value")
      return c.text("ok")
    })
    const res = await app.request("/set")
    const setCookieHeader = res.headers.get("set-cookie") ?? ""

    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=token-value`)
    expect(setCookieHeader).toContain("HttpOnly")
    expect(setCookieHeader).toContain("Secure")
    expect(setCookieHeader).toContain("SameSite=Lax")
    expect(setCookieHeader).toContain("Path=/")
    expect(setCookieHeader).toContain("Max-Age=2592000")
  })

  it("clears the session cookie with a matching path and immediate expiry", async () => {
    const { Hono } = await import("hono")
    const app = new Hono()
    app.get("/clear", (c) => {
      clearSessionCookie(c)
      return c.text("ok")
    })
    const res = await app.request("/clear")
    const setCookieHeader = res.headers.get("set-cookie") ?? ""

    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(setCookieHeader).toContain("Path=/")
    expect(setCookieHeader).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/)
  })
})
