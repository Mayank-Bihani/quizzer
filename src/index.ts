// Hono mounting and SCHEDULER orchestration: minute prepare/posts/safe close/alerts, hourly materialization and deferred weekly retry, Monday-IST weekly publication. No individual set timers — SCHEDULER.md.
//
// Later sprints add their own guarded route groups here and the scheduled handler; this file
// keeps a clear composition seam for both without implementing them ahead of their own packets.
import { Hono } from "hono"
import type { Bindings, Variables } from "./core/config"
import auth from "./routes/auth"
import { adminRoleMutation, adminRoster } from "./routes/admins"
import bank from "./routes/bank"
import images from "./routes/images"
import quizzes from "./routes/quizzes"
import { createBankContract } from "./db/bank"

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.onError((err, c) => {
  console.error("unhandled error", err instanceof Error ? err.name : typeof err)
  return c.json({ message: "Internal error" }, 500)
})

app.route("/api/auth", auth)
app.route("/api/admin/users", adminRoster)
app.route("/api/admin/users", adminRoleMutation)
app.route("/api/bank", bank)
app.route("/api/images", images)

app.use("/api/admin/quizzes/*", async (c, next) => {
  c.set("bank", createBankContract(c.env.DB))
  await next()
})
app.route("/api/admin/quizzes", quizzes)

export default app
