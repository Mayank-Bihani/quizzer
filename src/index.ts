// Hono mounting and SCHEDULER orchestration: minute prepare/posts/safe close/alerts, hourly materialization and deferred weekly retry, Monday-IST weekly publication. No individual set timers — SCHEDULER.md.
//
// Later sprints add their own guarded route groups here and the scheduled handler; this file
// keeps a clear composition seam for both without implementing them ahead of their own packets.
import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import type { Bindings, Variables } from "./core/config"
import auth from "./routes/auth"
import { adminRoleMutation, adminRoster } from "./routes/admins"
import bank from "./routes/bank"
import images from "./routes/images"
import quizzes from "./routes/quizzes"
import { play, quizzesPublic } from "./routes/play"
import { createBankContract } from "./db/bank"
import { listFailedPosts } from "./db/telegram"
import { createEmailSender, createTelegramSender } from "./services/observability"
import { listDueCloseQuizzes, listDuePrepareIds, openRoom, type RunDeps } from "./services/quiz-run"
import { runFailureAlertsPass, runPreparePass, type SchedulerDeps } from "./services/scheduler"

type Env = { Bindings: Bindings; Variables: Variables }

const app = new Hono<Env>()

app.onError((err, c) => {
  console.error("unhandled error", err instanceof Error ? err.name : typeof err)
  return c.json({ message: "Internal error" }, 500)
})

app.route("/api/auth", auth)
app.route("/api/admin/users", adminRoster)
app.route("/api/admin/users", adminRoleMutation)
app.route("/api/bank", bank)
app.route("/api/images", images)

const withBankContract: MiddlewareHandler<Env> = async (c, next) => {
  c.set("bank", createBankContract(c.env.DB))
  await next()
}
app.use("/api/admin/quizzes/*", withBankContract)
app.use("/api/quizzes/*", withBankContract)
app.use("/api/play/*", withBankContract)
app.route("/api/admin/quizzes", quizzes)
app.route("/api/quizzes", quizzesPublic)
app.route("/api/play", play)

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

const MINUTE_TICK_CRON = "* * * * *"

async function scheduled(controller: ScheduledController, env: Bindings): Promise<void> {
  // Hourly materialization and weekly board publication are Sprint 7; only the minute tick's
  // prepare+alerts portion is implemented here.
  if (controller.cron !== MINUTE_TICK_CRON) return

  const runDeps: RunDeps = { db: env.DB, kv: env.CACHE, bank: createBankContract(env.DB), now: () => Date.now(), hash: sha256Hex }
  const fixedNow = (now: number): RunDeps => ({ ...runDeps, now: () => now })

  const schedulerDeps: SchedulerDeps = {
    listDuePrepare: (now, limit) => listDuePrepareIds(fixedNow(now), now, limit),
    openRoom: (quizId, now) => openRoom(fixedNow(now), quizId),
    listDueClose: (now, limit) => listDueCloseQuizzes(fixedNow(now), now, limit),
    listFailedPosts: (limit) => listFailedPosts(env.DB, limit),
    telegram: env.TELEGRAM_BOT_TOKEN ? createTelegramSender(env.TELEGRAM_BOT_TOKEN) : null,
    email: env.ALERT_EMAIL && env.EMAIL_ALERT_ADDRESS ? createEmailSender(env.ALERT_EMAIL, env.EMAIL_ALERT_ADDRESS) : null,
    alertChatId: env.TELEGRAM_ALERT_CHAT_ID ?? null,
    alertEmailAddress: env.EMAIL_ALERT_ADDRESS ?? null,
    now: () => Date.now(),
  }

  await runPreparePass(schedulerDeps)
  await runFailureAlertsPass(schedulerDeps)
  // runClosePass is deliberately NOT called here — it is typed and tested (tests/scheduler-
  // minute.test.ts) but stays unbound from production traffic until Sprint 5 supplies the real
  // atomic closeQuiz. Wiring it here would let Sprint 4 pre-settle a whole quiz, which §8a forbids.
}

export default Object.assign(app, { scheduled })
