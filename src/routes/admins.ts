// GET /api/admin/users — requireRole('admin'); POST /api/admin/users/:id/role — requireRole('superadmin'), its own mount point, not covered by the outer /api/admin/* group's guard — AUTH.md §5, §3.3, §3.5

import { Hono } from "hono"
import type { Bindings, Variables } from "../core/config"
import type { AdminListUsersResponse, SetUserRoleRequest, SetUserRoleResponse } from "../core/api"
import type { Role } from "../core/contracts"
import { requireRole } from "../middleware/auth"
import { listUsers, setUserRole } from "../db/users"

const ROLES: readonly Role[] = ["student", "admin", "superadmin"]
const MAX_TARGET_ID_LENGTH = 256

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
}

// GET /api/admin/users — ordinary admin scope. Deliberately its own sub-app so it never shares a
// route-group guard with the superadmin-only mutation below.
export const adminRoster = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminRoster.get("/", requireRole("admin"), async (c) => {
  const users = await listUsers(c.env.DB)
  const body: AdminListUsersResponse = { users }
  return c.json(body, 200)
})

// POST /api/admin/users/:id/role — superadmin-only, its own mount point.
export const adminRoleMutation = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminRoleMutation.post("/:id/role", requireRole("superadmin"), async (c) => {
  const targetId = c.req.param("id")
  if (targetId.length === 0 || targetId.length > MAX_TARGET_ID_LENGTH) {
    return c.json({ message: "Invalid user id" }, 400)
  }

  let parsed: unknown
  try {
    parsed = await c.req.json()
  } catch {
    return c.json({ message: "Invalid request body" }, 400)
  }
  const role = (parsed as Partial<SetUserRoleRequest> | null)?.role
  if (!isRole(role)) {
    return c.json({ message: "Invalid role" }, 400)
  }

  const result = await setUserRole(c.env.DB, c.env.CACHE, targetId, role)
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ message: "User not found" }, 404)
    return c.json({ message: "Cannot remove the last remaining superadmin" }, 409)
  }

  const body: SetUserRoleResponse = result.user
  return c.json(body, 200)
})
