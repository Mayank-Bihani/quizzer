// POST /api/auth/google, POST /api/auth/logout, GET /api/auth/me — /me returns CurrentUser — AUTH.md §5; CONTRACTS.md §2

import { Hono } from "hono"
import type { Bindings, Variables } from "../core/config"
import { MAX_GOOGLE_SIGNIN_BODY_BYTES } from "../core/config"
import type { GoogleSignInRequest, GoogleSignInResponse, GetMeResponse, LogoutResponse } from "../core/api"
import { currentUser, requireAuth } from "../middleware/auth"
import { bootstrapSuperadminIfNeeded, findOrCreateByGoogleIdentity, getUserById } from "../db/users"
import { clearSessionCookie, setSessionCookie, signSession, verifyGoogleIdToken } from "../services/jwt"

const BAD_TOKEN = { message: "Invalid or expired Google ID token" }

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Bounded, allowlisted parse of the sign-in body — the only shape this route accepts.
async function parseGoogleSignInBody(c: {
  req: { header: (name: string) => string | undefined; text: () => Promise<string> }
}): Promise<string | null> {
  const contentLength = Number(c.req.header("content-length") ?? "0")
  if (contentLength > MAX_GOOGLE_SIGNIN_BODY_BYTES) return null

  const rawBody = await c.req.text()
  if (rawBody.length > MAX_GOOGLE_SIGNIN_BODY_BYTES) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }
  const idToken = (parsed as Partial<GoogleSignInRequest> | null)?.idToken
  return typeof idToken === "string" && idToken.length > 0 ? idToken : null
}

auth.post("/google", async (c) => {
  const idToken = await parseGoogleSignInBody(c)
  if (!idToken) return c.json(BAD_TOKEN, 401)

  const now = () => Math.floor(Date.now() / 1000)

  let identity
  try {
    identity = await verifyGoogleIdToken(idToken, {
      fetchImpl: globalThis.fetch.bind(globalThis),
      now,
      kv: c.env.CACHE,
      clientId: c.env.GOOGLE_CLIENT_ID,
    })
  } catch {
    return c.json(BAD_TOKEN, 401)
  }

  let user
  try {
    user = await findOrCreateByGoogleIdentity(c.env.DB, identity, () => Date.now())
  } catch {
    return c.json(BAD_TOKEN, 401)
  }

  await bootstrapSuperadminIfNeeded(c.env.DB, user.id, identity.email, c.env.SUPERADMIN_EMAIL)
  // Bootstrap may have just promoted this exact user; re-read so the response reflects it.
  const afterBootstrap = await getUserById(c.env.DB, user.id)

  const token = await signSession(user.id, c.env.SESSION_SIGNING_KEY, now)
  setSessionCookie(c, token)

  const body: GoogleSignInResponse = afterBootstrap ?? user
  return c.json(body, 200)
})

auth.post("/logout", async (c) => {
  clearSessionCookie(c)
  const body: LogoutResponse = { success: true }
  return c.json(body, 200)
})

auth.get("/me", requireAuth, (c) => {
  const body: GetMeResponse = currentUser(c)
  return c.json(body, 200)
})

export default auth
