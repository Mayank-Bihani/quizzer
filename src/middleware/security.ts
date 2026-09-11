// API response hardening — AC-8: no-store + nosniff on every /api/* response, composed alongside
// (never replacing) the existing AUTH guard/error path in src/index.ts. PLAN.md; MODULES.md.

import type { MiddlewareHandler } from "hono"
import type { Bindings, Variables } from "../core/config"

type Env = { Bindings: Bindings; Variables: Variables }

export const apiHardeningHeaders: MiddlewareHandler<Env> = async (c, next) => {
  c.header("Cache-Control", "no-store")
  c.header("X-Content-Type-Options", "nosniff")
  await next()
}

// Never a stack trace, SQL/provider detail, environment value, token, cookie, answer, or
// email/chat identifier — only ever this fixed generic body. Callers still choose their own
// status code.
export function redactedErrorBody(): { message: string } {
  return { message: "Internal error" }
}
