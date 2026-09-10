// users table; AuthContract — requireAuth, requireRole, currentUser, getUserById; requireRole and currentUser both read the same role:<uid> KV cache with a D1 fallback — no separate D1-direct path for requireRole — AUTH.md §3.2-3.5, §4-5; CONTRACTS.md §2

import type { CurrentUser, Role } from "../core/contracts"
import type { AdminUserSummary } from "../core/api"
import type { VerifiedGoogleIdentity } from "../services/jwt"

const ROLES: readonly Role[] = ["student", "admin", "superadmin"]

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
}

function roleCacheKey(userId: string): string {
  return `role:${userId}`
}

type UserRow = {
  id: string
  name: string
  role: string
  picture_url: string | null
  email: string
  created_at: number
}

function toCurrentUser(row: Pick<UserRow, "id" | "name" | "role" | "picture_url">): CurrentUser {
  return { id: row.id, name: row.name, role: row.role as Role, pictureUrl: row.picture_url }
}

function toAdminUserSummary(row: UserRow): AdminUserSummary {
  return { ...toCurrentUser(row), email: row.email, createdAt: row.created_at }
}

export class UserPersistenceError extends Error {
  constructor() {
    super("user identity write failed")
    this.name = "UserPersistenceError"
  }
}

export async function findOrCreateByGoogleIdentity(
  db: D1Database,
  identity: VerifiedGoogleIdentity,
  now: () => number
): Promise<CurrentUser> {
  const candidateId = crypto.randomUUID()
  let row: UserRow | null
  try {
    row = await db
      .prepare(
        `INSERT INTO users (id, google_sub, email, name, picture_url, role, created_at)
         VALUES (?, ?, ?, ?, ?, 'student', ?)
         ON CONFLICT(google_sub) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           picture_url = excluded.picture_url
         RETURNING id, name, role, picture_url, email, created_at`
      )
      .bind(candidateId, identity.sub, identity.email, identity.name, identity.pictureUrl, now())
      .first<UserRow>()
  } catch {
    throw new UserPersistenceError()
  }
  if (!row) throw new UserPersistenceError()
  return toCurrentUser(row)
}

export async function getUserById(db: D1Database, id: string): Promise<CurrentUser | null> {
  const row = await db
    .prepare("SELECT id, name, role, picture_url FROM users WHERE id = ?")
    .bind(id)
    .first<Pick<UserRow, "id" | "name" | "role" | "picture_url">>()
  return row ? toCurrentUser(row) : null
}

export async function listUsers(db: D1Database): Promise<AdminUserSummary[]> {
  const { results } = await db
    .prepare("SELECT id, name, role, picture_url, email, created_at FROM users ORDER BY created_at ASC, id ASC")
    .all<UserRow>()
  return results.map(toAdminUserSummary)
}

export async function getRole(db: D1Database, kv: KVNamespace, userId: string): Promise<Role | null> {
  let cached: string | null = null
  try {
    cached = await kv.get(roleCacheKey(userId))
  } catch {
    cached = null
  }
  if (isRole(cached)) return cached

  const row = await db.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first<{ role: string }>()
  if (!row) return null
  const role = row.role as Role

  try {
    await kv.put(roleCacheKey(userId), role)
  } catch {
    // Cache-write failure never invalidates a correct D1 read.
  }
  return role
}

export async function bootstrapSuperadminIfNeeded(
  db: D1Database,
  userId: string,
  verifiedEmail: string,
  superadminEmail: string
): Promise<void> {
  const normalizedVerified = verifiedEmail.trim().toLowerCase()
  const normalizedConfigured = superadminEmail.trim().toLowerCase()
  if (!normalizedConfigured || normalizedVerified !== normalizedConfigured) return

  await db
    .prepare(
      `UPDATE users
       SET role = 'superadmin'
       WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'superadmin')`
    )
    .bind(userId)
    .run()
}

export type SetUserRoleResult =
  | { ok: true; user: AdminUserSummary }
  | { ok: false; reason: "not_found" | "last_superadmin" }

export async function setUserRole(
  db: D1Database,
  kv: KVNamespace,
  targetId: string,
  role: Role
): Promise<SetUserRoleResult> {
  const result = await db
    .prepare(
      `UPDATE users
       SET role = ?
       WHERE id = ?
         AND NOT (
           role = 'superadmin'
           AND ? != 'superadmin'
           AND (SELECT COUNT(*) FROM users WHERE role = 'superadmin') <= 1
         )`
    )
    .bind(role, targetId, role)
    .run()

  if (result.meta.changes !== 1) {
    const exists = await db.prepare("SELECT id FROM users WHERE id = ?").bind(targetId).first()
    return { ok: false, reason: exists ? "last_superadmin" : "not_found" }
  }

  try {
    await kv.delete(roleCacheKey(targetId))
  } catch {
    // A correct, durable D1 write must not be undone by a best-effort cache invalidation failure.
  }

  const row = await db
    .prepare("SELECT id, name, role, picture_url, email, created_at FROM users WHERE id = ?")
    .bind(targetId)
    .first<UserRow>()
  if (!row) throw new UserPersistenceError()
  return { ok: true, user: toAdminUserSummary(row) }
}
