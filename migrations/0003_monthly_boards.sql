-- Sprint 11: monthly leaderboard board alongside the existing weekly boards.

-- Field-for-field identical to weekly_boards (migrations/0001_init.sql), with week_start renamed
-- to month_start. Rank uses total_score across quizzes taken in the calendar month; quizzes_taken
-- is context, not a divisor/tie-break. Exact total-score ties share a dense rank.
CREATE TABLE monthly_boards (
  month_start    TEXT NOT NULL,         -- ISO date, the 1st of the month in Asia/Kolkata (IST)
  type           TEXT NOT NULL CHECK (type IN ('verbal', 'quant', 'lr', 'overall')),
  user_id        TEXT NOT NULL REFERENCES users(id),
  quizzes_taken  INTEGER NOT NULL,
  total_score    REAL NOT NULL,
  rank           INTEGER NOT NULL,
  PRIMARY KEY (month_start, type, user_id)
);

-- SQLite/D1 cannot ALTER a CHECK constraint, so widening telegram_posts.kind to also accept
-- 'monthly' requires the standard recreate-table procedure: create the new table, copy every row,
-- drop the old table, rename. Every other column/constraint is preserved verbatim from
-- migrations/0001_init.sql. week_start is reused (not renamed) for monthly rows too — it holds a
-- month-start date for kind='monthly' rows, a week-start date for kind='weekly' rows.
PRAGMA foreign_keys=OFF;

CREATE TABLE telegram_posts_new (
  quiz_id     TEXT REFERENCES quizzes(id),   -- NULL for weekly/monthly posts
  kind        TEXT NOT NULL
                CHECK (kind IN ('announce', 'soon', 'open', 'result', 'weekly', 'monthly', 'cancelled')),
  week_start  TEXT,                          -- set for 'weekly'/'monthly' (month-start date for the latter)
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed')),
  message_id  TEXT,                          -- NULL until status='sent'
  error       TEXT,                          -- set when status='failed'
  claimed_at  INTEGER NOT NULL,               -- when this row was inserted (the claim)
  sent_at     INTEGER,                        -- NULL until status='sent'
  UNIQUE (quiz_id, kind),
  UNIQUE (week_start, kind)
);

INSERT INTO telegram_posts_new (quiz_id, kind, week_start, status, message_id, error, claimed_at, sent_at)
  SELECT quiz_id, kind, week_start, status, message_id, error, claimed_at, sent_at FROM telegram_posts;

DROP TABLE telegram_posts;
ALTER TABLE telegram_posts_new RENAME TO telegram_posts;

PRAGMA foreign_keys=ON;
