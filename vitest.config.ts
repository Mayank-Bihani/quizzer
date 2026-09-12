import fs from "node:fs"
import path from "node:path"
import { configDefaults, defineConfig } from "vitest/config"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers"

// Local-only synthetic test values (AUTH.md §3, §6) — never committed, see .dev.vars.test /
// .gitignore. Kept out of this committed file so no fixture/config ever carries a literal
// secret-shaped value.
function loadTestVars(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${path.basename(filePath)}. Create it with GOOGLE_CLIENT_ID, SESSION_SIGNING_KEY ` +
        "(32+ bytes), and SUPERADMIN_EMAIL — see AUTH.md §3, §6. Never commit real values."
    )
  }
  const vars: Record<string, string> = {}
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return vars
}

const testVars = loadTestVars(path.join(import.meta.dirname, ".dev.vars.test"))
const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"))

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "web/**"],
    setupFiles: ["./tests/setup/apply-migrations.ts"],
  },
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          GOOGLE_CLIENT_ID: testVars.GOOGLE_CLIENT_ID,
          SESSION_SIGNING_KEY: testVars.SESSION_SIGNING_KEY,
          SUPERADMIN_EMAIL: testVars.SUPERADMIN_EMAIL,
          // Several tests call app.scheduled(...) directly, exercising the real cron handler.
          // Without an explicit override here, any TELEGRAM_* var left unset falls through to the
          // developer's real .dev.vars (Miniflare's default dev-vars merge) — which is how a local
          // `vitest run` ended up posting real messages to the real student Telegram group.
          // Forcing these here, regardless of .dev.vars, keeps every test on the no-op bot client.
          TELEGRAM_ENABLED: "false",
          TELEGRAM_BOT_TOKEN: "",
          TELEGRAM_CHAT_ID: "test-chat-id",
          TELEGRAM_ALERT_CHAT_ID: "test-alert-chat-id",
        },
      },
    }),
  ],
})
