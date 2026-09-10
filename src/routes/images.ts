// GET /api/images/:key — serves an R2 object by key, owned end to end by BANK; NOT in BANK's admin-only route group — requireAuth() only, no per-run scoping (illustrative images, not solutions; scoping would need BANK to read QUIZZING-owned runtime tables for no real benefit) — BANK.md §5; AUTH.md §3.3; MODULES.md §5

import { Hono } from "hono"
import type { Bindings, Variables } from "../core/config"
import { requireAuth } from "../middleware/auth"
import { getImage } from "../services/images"

const images = new Hono<{ Bindings: Bindings; Variables: Variables }>()

images.get("/:key", requireAuth, async (c) => {
  const object = await getImage(c.env.IMAGES, c.req.param("key"))
  if (!object) return c.json({ message: "Image not found" }, 404)

  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  })
})

export default images
