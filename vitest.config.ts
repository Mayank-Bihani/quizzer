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
        },
      },
    }),
  ],
})
