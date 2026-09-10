// Hono guard middleware enforcing AuthContract semantics (requireAuth, requireRole, currentUser,
// getUserById) without structurally implementing its framework-neutral `void` signatures —
// AUTH.md §3.2-3.5; CONTRACTS.md §2; src/core/contracts.ts:18-23.

import type { Context, MiddlewareHandler } from "hono"
import { getCookie } from "hono/cookie"
import type { Bindings, Variables } from "../core/config"
import { SESSION_COOKIE_NAME } from "../core/config"
import type { CurrentUser, Role } from "../core/contracts"
import { getRole, getUserById as getUserByIdFromDb } from "../db/users"
import { verifySession } from "../services/jwt"

type Env = { Bindings: Bindings; Variables: Variables }

const UNAUTHORIZED = { message: "Authentication required" }
const FORBIDDEN = { message: "Insufficient permissions" }

const ROLE_RANK: Record<Role, number> = { student: 0, admin: 1, superadmin: 2 }

async function resolveCurrentUser(c: Context<Env>): Promise<CurrentUser | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return null

  let claims
  try {
    claims = await verifySession(token, c.env.SESSION_SIGNING_KEY, () => Math.floor(Date.now() / 1000))
  } catch {
    return null
  }

  const user = await getUserByIdFromDb(c.env.DB, claims.uid)
  if (!user) return null

  const role = await getRole(c.env.DB, c.env.CACHE, claims.uid)
  if (!role) return null

  return { ...user, role }
}

export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const user = await resolveCurrentUser(c)
  if (!user) return c.json(UNAUTHORIZED, 401)
  c.set("currentUser", user)
  await next()
}

export function requireRole(minRole: "admin" | "superadmin"): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get("currentUser") ?? (await resolveCurrentUser(c))
    if (!user) return c.json(UNAUTHORIZED, 401)
    if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) return c.json(FORBIDDEN, 403)
    c.set("currentUser", user)
    await next()
  }
}

export function currentUser(c: Context<Env>): CurrentUser {
  return c.get("currentUser")
}

export async function getUserById(c: Context<Env>, id: string): Promise<CurrentUser | null> {
  return getUserByIdFromDb(c.env.DB, id)
}
