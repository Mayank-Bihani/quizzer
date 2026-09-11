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
import { boards } from "./routes/boards"
import images from "./routes/images"
import quizzes from "./routes/quizzes"
import { play, quizzesPublic } from "./routes/play"
import { resultsQuizRoutes, studentsRoutes } from "./routes/results"
import { createBankContract } from "./db/bank"
import { listDueAnnounce, listDueCancelledNotifications } from "./db/quizzes"
import { createTelegramContract, listFailedPosts } from "./db/telegram"
import { createEmailSender, createTelegramSender } from "./services/observability"
import { listDueCloseQuizzes, listDuePrepareIds, openRoom, type RunDeps } from "./services/quiz-run"
import { createCloseQuiz } from "./services/quiz-results"
import { materializeTemplates } from "./services/quiz-materializer"
import { computeWeeklyBoards } from "./services/quiz-boards"
import { mostRecentlyElapsedWeekStart } from "./core/schedule"
import {
  createOnQuizClosed,
  runAnnouncePass,
  runCancelledNotifyPass,
  runClosePass,
  runFailureAlertsPass,
  runMaterializePass,
  runPreparePass,
  runWeeklyPass,
  runWeeklyRetrySweep,
  type SchedulerDeps,
} from "./services/scheduler"
import { createNoOpBotClient, createTelegramBotClient } from "./services/telegram"

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
app.use("/api/students/*", withBankContract)

// TELEGRAM_ENABLED gates the client at composition time, never inside claimAndSend itself, so
// local/test runs exercise full claim-then-send idempotency without ever reaching
// api.telegram.org — TELEGRAM.md §8. Lets routes/results.ts's lazy-close path fire the same
// post-commit hook the scheduler's close pass uses, without that route file importing anything
// Telegram-shaped (AC-13) — it only ever sees the locally-typed callback via c.get.
const withTelegramCloseHook: MiddlewareHandler<Env> = async (c, next) => {
  const bot = c.env.TELEGRAM_ENABLED === "true" && c.env.TELEGRAM_BOT_TOKEN ? createTelegramBotClient(c.env.TELEGRAM_BOT_TOKEN) : createNoOpBotClient()
  const telegram = createTelegramContract(c.env.DB, bot, c.env.TELEGRAM_CHAT_ID ?? "")
  c.set("onQuizClosed", createOnQuizClosed(telegram))
  await next()
}
app.use("/api/quizzes/*", withTelegramCloseHook)

app.route("/api/admin/quizzes", quizzes)
app.route("/api/quizzes", quizzesPublic)
app.route("/api/quizzes", resultsQuizRoutes)
app.route("/api/play", play)
app.route("/api/students", studentsRoutes)
app.route("/api/boards", boards)

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

const MINUTE_TICK_CRON = "* * * * *"
const HOURLY_CRON = "0 * * * *"
const WEEKLY_CRON = "0 19 * * SUN"

async function scheduled(controller: ScheduledController, env: Bindings): Promise<void> {
  const bot = env.TELEGRAM_ENABLED === "true" && env.TELEGRAM_BOT_TOKEN ? createTelegramBotClient(env.TELEGRAM_BOT_TOKEN) : createNoOpBotClient()
  const telegram = createTelegramContract(env.DB, bot, env.TELEGRAM_CHAT_ID ?? "")

  if (controller.cron === HOURLY_CRON) {
    const now = Date.now()
    await runMaterializePass({
      materializeTemplates: (days, materializeNow) =>
        materializeTemplates({ db: env.DB, bank: createBankContract(env.DB), random: () => Math.random() }, days, materializeNow),
      now: () => now,
      telegram: env.TELEGRAM_BOT_TOKEN ? createTelegramSender(env.TELEGRAM_BOT_TOKEN) : null,
      email: env.ALERT_EMAIL && env.EMAIL_ALERT_ADDRESS ? createEmailSender(env.ALERT_EMAIL, env.EMAIL_ALERT_ADDRESS) : null,
      alertChatId: env.TELEGRAM_ALERT_CHAT_ID ?? null,
      alertEmailAddress: env.EMAIL_ALERT_ADDRESS ?? null,
    })
    await runWeeklyRetrySweep((weekStart) => computeWeeklyBoards({ db: env.DB, kv: env.CACHE }, weekStart), mostRecentlyElapsedWeekStart(now), telegram)
    return
  }

  if (controller.cron === WEEKLY_CRON) {
    const now = Date.now()
    await runWeeklyPass((weekStart) => computeWeeklyBoards({ db: env.DB, kv: env.CACHE }, weekStart), mostRecentlyElapsedWeekStart(now), telegram)
    return
  }

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
  await runClosePass(schedulerDeps, createCloseQuiz(env.DB, env.CACHE, createOnQuizClosed(telegram)))
  await runAnnouncePass({ listDueAnnounce: (now, limit) => listDueAnnounce(env.DB, now, limit), now: () => Date.now() }, telegram)
  await runCancelledNotifyPass({ listDueCancelledNotifications: (limit) => listDueCancelledNotifications(env.DB, limit) }, telegram)
}

export default Object.assign(app, { scheduled })
