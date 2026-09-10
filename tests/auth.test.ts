import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import app from "../src/index"
import { getRole, setUserRole } from "../src/db/users"
import { jwksResponse, makeGoogleKeyPair, signGoogleIdToken } from "./helpers/google"

function extractCookie(res: Response, name: string): string | null {
  const header = res.headers.get("set-cookie") ?? ""
  const match = header.match(new RegExp(`${name}=([^;]*)`))
  return match ? match[1] : null
}

async function googleSignIn(idToken: string) {
  return app.request(
    "/api/auth/google",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
    env
  )
}

function authedRequest(path: string, cookie: string, init: RequestInit = {}) {
  return app.request(
    path,
    { ...init, headers: { ...(init.headers ?? {}), cookie: `quizzer_session=${cookie}` } },
    env
  )
}

beforeEach(async () => {
  await env.CACHE.delete("jwks:google")
})

describe("POST /api/auth/google", () => {
  it("issues a session for a valid Google identity and creates one student row", async () => {
    const { privateKey, jwk } = await makeGoogleKeyPair("kid-1")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jwksResponse([jwk]))
    )
    const idToken = await signGoogleIdToken(privateKey, "kid-1", env.GOOGLE_CLIENT_ID, {
      sub: "sub-first-signin",
      email: "first@example.com",
    })

    const res = await googleSignIn(idToken)
    const body = await res.json<Record<string, unknown>>()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ role: "student" })
    expect(body).not.toHaveProperty("email")
    expect(body).not.toHaveProperty("token")

    const setCookieHeader = res.headers.get("set-cookie") ?? ""
    expect(setCookieHeader).toContain("HttpOnly")
    expect(setCookieHeader).toContain("Secure")
    expect(setCookieHeader).toContain("SameSite=Lax")
    expect(setCookieHeader).toContain("Max-Age=2592000")

    const row = await env.DB.prepare("SELECT role, google_sub FROM users WHERE google_sub = ?")
      .bind("sub-first-signin")
      .first<{ role: string; google_sub: string }>()
    expect(row).toMatchObject({ role: "student", google_sub: "sub-first-signin" })

    vi.unstubAllGlobals()
  })

  it("resolves repeat sign-in to the same row and never overwrites an elevated role", async () => {
    const { privateKey, jwk } = await makeGoogleKeyPair("kid-2")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jwksResponse([jwk]))
    )
    const sub = "sub-repeat"
    const first = await signGoogleIdToken(privateKey, "kid-2", env.GOOGLE_CLIENT_ID, {
      sub,
      email: "repeat@example.com",
      name: "Original Name",
    })
    const firstRes = await googleSignIn(first)
    const firstBody = await firstRes.json<{ id: string }>()

    // Promote out-of-band, the way a superadmin mutation would.
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(firstBody.id).run()

    const second = await signGoogleIdToken(privateKey, "kid-2", env.GOOGLE_CLIENT_ID, {
      sub,
      email: "repeat@example.com",
      name: "Updated Name",
    })
    const secondRes = await googleSignIn(second)
    const secondBody = await secondRes.json<{ id: string; role: string }>()

    expect(secondBody.id).toBe(firstBody.id)
    expect(secondBody.role).toBe("admin")
    const row = await env.DB.prepare("SELECT name FROM users WHERE id = ?")
      .bind(firstBody.id)
      .first<{ name: string }>()
    expect(row?.name).toBe("Updated Name")

    vi.unstubAllGlobals()
  })

  it("rejects a token with the wrong audience with a generic 401", async () => {
    const { privateKey, jwk } = await makeGoogleKeyPair("kid-3")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jwksResponse([jwk]))
    )
    const idToken = await signGoogleIdToken(privateKey, "kid-3", "someone-elses-audience")

    const res = await googleSignIn(idToken)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ message: expect.any(String) })

    vi.unstubAllGlobals()
  })

  it("bootstraps only the configured superadmin email, exactly once, idempotently", async () => {
    const { privateKey, jwk } = await makeGoogleKeyPair("kid-4")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jwksResponse([jwk]))
    )

    const nonMatching = await signGoogleIdToken(privateKey, "kid-4", env.GOOGLE_CLIENT_ID, {
      sub: "sub-nonmatch",
      email: "not-the-superadmin@example.com",
    })
    const nonMatchRes = await googleSignIn(nonMatching)
    expect((await nonMatchRes.json<{ role: string }>()).role).toBe("student")

    const matching1 = await signGoogleIdToken(privateKey, "kid-4", env.GOOGLE_CLIENT_ID, {
      sub: "sub-match",
      email: env.SUPERADMIN_EMAIL,
    })
    const match1Res = await googleSignIn(matching1)
    const match1Body = await match1Res.json<{ role: string; id: string }>()
    expect(match1Body.role).toBe("superadmin")

    const matching2 = await signGoogleIdToken(privateKey, "kid-4", env.GOOGLE_CLIENT_ID, {
      sub: "sub-match",
      email: env.SUPERADMIN_EMAIL,
    })
    const match2Res = await googleSignIn(matching2)
    const match2Body = await match2Res.json<{ role: string; id: string }>()
    expect(match2Body.role).toBe("superadmin")
    expect(match2Body.id).toBe(match1Body.id)

    const superadminCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'")
      .first<{ n: number }>()
    expect(superadminCount?.n).toBe(1)

    vi.unstubAllGlobals()
  })
})

async function signInAndGetCookie(
  overrides: Record<string, unknown> = {},
  kid = crypto.randomUUID()
): Promise<{ cookie: string; body: { id: string; role: string } }> {
  const { privateKey, jwk } = await makeGoogleKeyPair(kid)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jwksResponse([jwk]))
  )
  const idToken = await signGoogleIdToken(privateKey, kid, env.GOOGLE_CLIENT_ID, {
    sub: overrides.sub ?? crypto.randomUUID(),
    email: overrides.email ?? `${crypto.randomUUID()}@example.com`,
    ...overrides,
  })
  const res = await googleSignIn(idToken)
  const body = await res.json<{ id: string; role: string }>()
  const cookie = extractCookie(res, "quizzer_session")
  vi.unstubAllGlobals()
  if (!cookie) throw new Error("sign-in did not set a session cookie")
  return { cookie, body }
}

describe("GET /api/auth/me and POST /api/auth/logout", () => {
  it("returns the current user for a valid session", async () => {
    const { cookie, body } = await signInAndGetCookie()

    const res = await authedRequest("/api/auth/me", cookie)
    const meBody = await res.json<{ id: string }>()

    expect(res.status).toBe(200)
    expect(meBody.id).toBe(body.id)
  })

  it("returns 401 for a missing or forged session cookie", async () => {
    const missing = await app.request("/api/auth/me", {}, env)
    expect(missing.status).toBe(401)

    const forged = await authedRequest("/api/auth/me", "not-a-real-token")
    expect(forged.status).toBe(401)
  })

  it("logout always succeeds, clears the cookie, and is idempotent", async () => {
    const { cookie } = await signInAndGetCookie()

    const first = await authedRequest("/api/auth/logout", cookie, { method: "POST" })
    expect(await first.json()).toEqual({ success: true })
    const clearedCookie = first.headers.get("set-cookie") ?? ""
    expect(clearedCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/)

    const second = await app.request("/api/auth/logout", { method: "POST" }, env)
    expect(await second.json()).toEqual({ success: true })
    // Sessions are stateless (AUTH.md §6) — logout only clears the cookie client-side; the old
    // token's own signature/expiry is untouched, so a manually-resent copy still authenticates.
    const meWithOldToken = await authedRequest("/api/auth/me", cookie)
    expect(meWithOldToken.status).toBe(200)
  })
})

describe("admin guard matrix", () => {
  it("rejects signed-out callers with 401 on both roster and role mutation", async () => {
    const roster = await app.request("/api/admin/users", {}, env)
    expect(roster.status).toBe(401)

    const mutate = await app.request(
      "/api/admin/users/some-id/role",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "admin" }) },
      env
    )
    expect(mutate.status).toBe(401)
  })

  it("rejects a student with 403 on both roster and role mutation", async () => {
    const { cookie } = await signInAndGetCookie()

    const roster = await authedRequest("/api/admin/users", cookie)
    expect(roster.status).toBe(403)

    const mutate = await authedRequest("/api/admin/users/some-id/role", cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    })
    expect(mutate.status).toBe(403)
  })

  it("lets an admin read the roster but rejects role mutation with 403 and no write", async () => {
    const { cookie, body } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(body.id).run()
    await env.CACHE.delete(`role:${body.id}`)

    const roster = await authedRequest("/api/admin/users", cookie)
    expect(roster.status).toBe(200)

    const { cookie: targetCookie, body: target } = await signInAndGetCookie()
    const mutate = await authedRequest(`/api/admin/users/${target.id}/role`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    })
    expect(mutate.status).toBe(403)
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(target.id).first<{ role: string }>()
    expect(row?.role).toBe("student")
    void targetCookie
  })

  it("lets a superadmin reach both the roster and role mutation", async () => {
    const { cookie, body } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(body.id).run()
    await env.CACHE.delete(`role:${body.id}`)

    const roster = await authedRequest("/api/admin/users", cookie)
    expect(roster.status).toBe(200)

    const { body: target } = await signInAndGetCookie()
    const mutate = await authedRequest(`/api/admin/users/${target.id}/role`, cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    })
    expect(mutate.status).toBe(200)
  })
})

describe("GET /api/admin/users", () => {
  it("returns a bounded roster in deterministic order without session fields", async () => {
    const { cookie, body } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(body.id).run()
    await env.CACHE.delete(`role:${body.id}`)

    const res = await authedRequest("/api/admin/users", cookie)
    const roster = await res.json<{ users: Array<Record<string, unknown>> }>()

    expect(res.status).toBe(200)
    expect(Array.isArray(roster.users)).toBe(true)
    expect(roster.users.length).toBeGreaterThanOrEqual(1)
    for (const user of roster.users) {
      expect(user).toEqual(
        expect.objectContaining({ id: expect.any(String), name: expect.any(String), role: expect.any(String) })
      )
      expect(user).not.toHaveProperty("token")
      expect(user).not.toHaveProperty("googleSub")
    }
  })
})

describe("POST /api/admin/users/:id/role", () => {
  it("updates the target role, invalidates the KV cache, and returns the summary", async () => {
    const { cookie: superCookie, body: superUser } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(superUser.id).run()
    await env.CACHE.delete(`role:${superUser.id}`)

    const { body: target } = await signInAndGetCookie()
    await env.CACHE.put(`role:${target.id}`, "student")

    const res = await authedRequest(`/api/admin/users/${target.id}/role`, superCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    })
    const updated = await res.json<{ role: string }>()

    expect(res.status).toBe(200)
    expect(updated.role).toBe("admin")
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(target.id).first<{ role: string }>()
    expect(row?.role).toBe("admin")
    expect(await env.CACHE.get(`role:${target.id}`)).toBeNull()
  })

  it("returns 404 for an unknown target id", async () => {
    const { cookie: superCookie, body: superUser } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(superUser.id).run()
    await env.CACHE.delete(`role:${superUser.id}`)

    const res = await authedRequest("/api/admin/users/does-not-exist/role", superCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    })

    expect(res.status).toBe(404)
  })

  it("blocks demoting the last remaining superadmin with 409 and no write", async () => {
    const { cookie: superCookie, body: superUser } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(superUser.id).run()
    await env.CACHE.delete(`role:${superUser.id}`)
    await env.DB.prepare("DELETE FROM users WHERE role = 'superadmin' AND id != ?").bind(superUser.id).run()

    const res = await authedRequest(`/api/admin/users/${superUser.id}/role`, superCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    })

    expect(res.status).toBe(409)
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
      .bind(superUser.id)
      .first<{ role: string }>()
    expect(row?.role).toBe("superadmin")
  })

  it("allows demotion once a second superadmin exists", async () => {
    const { cookie: superCookie, body: superUser } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(superUser.id).run()
    await env.CACHE.delete(`role:${superUser.id}`)

    const { body: secondSuper } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(secondSuper.id).run()

    const res = await authedRequest(`/api/admin/users/${superUser.id}/role`, superCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    })

    expect(res.status).toBe(200)
    const superadminCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'")
      .first<{ n: number }>()
    expect(superadminCount?.n).toBeGreaterThanOrEqual(1)
  })

  it("rejects an unknown role value with 400 and no write", async () => {
    const { cookie: superCookie, body: superUser } = await signInAndGetCookie()
    await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(superUser.id).run()
    await env.CACHE.delete(`role:${superUser.id}`)

    const { body: target } = await signInAndGetCookie()
    const res = await authedRequest(`/api/admin/users/${target.id}/role`, superCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    })

    expect(res.status).toBe(400)
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(target.id).first<{ role: string }>()
    expect(row?.role).toBe("student")
  })
})

describe("src/db/users.ts — getRole KV/D1 boundary", () => {
  it("falls back to D1 when the KV read throws, without trusting stale data", async () => {
    const { body } = await signInAndGetCookie()
    await env.CACHE.delete(`role:${body.id}`)

    const throwingKv = {
      get: vi.fn(async () => {
        throw new Error("kv outage")
      }),
      put: env.CACHE.put.bind(env.CACHE),
    } as unknown as KVNamespace

    const role = await getRole(env.DB, throwingKv, body.id)
    expect(role).toBe("student")
  })

  it("returns null for a role lookup on a user that does not exist", async () => {
    const role = await getRole(env.DB, env.CACHE, "no-such-user")
    expect(role).toBeNull()
  })

  it("setUserRole succeeds idempotently when the new role equals the current one", async () => {
    const { body } = await signInAndGetCookie()

    const result = await setUserRole(env.DB, env.CACHE, body.id, "student")

    expect(result).toEqual({ ok: true, user: expect.objectContaining({ id: body.id, role: "student" }) })
  })

  it("setUserRole reports not_found for a missing target distinctly from last_superadmin", async () => {
    const result = await setUserRole(env.DB, env.CACHE, "no-such-user", "admin")
    expect(result).toEqual({ ok: false, reason: "not_found" })
  })
})
