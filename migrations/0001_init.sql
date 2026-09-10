-- Quizzer — initial schema (D1 / SQLite)
--
-- Narrative version: PLAN.md §"Data model (D1)". Module ownership: MODULES.md §"Table
-- ownership" and §"KV keyspace ownership". Fixes trace to AUDIT.md §11 and
-- V1 timing/batching revision: 2026-09-09; see QUIZZING.md and DATA_MODEL.md.
--
-- One writer per table, enforced by convention (module boundary), not by D1 permissions:
--   AUTH      → users
--   BANK      → passages, questions
--   QUIZZING  → quiz_templates, quizzes, quiz_units, quiz_questions, quiz_seats, participants,
--               participant_units, answers,
--               weekly_boards
--   TELEGRAM  → telegram_posts
--
-- Timestamps are epoch milliseconds (INTEGER) unless noted otherwise. `Asia/Kolkata` is a
-- presentation concern only — nothing here stores or reads a local time (SCHEDULER.md §6),
-- except `weekly_boards.week_start`, which is IST-anchored — see the note on that table.

PRAGMA foreign_keys = ON;

-- ============================================================================
-- AUTH
-- ============================================================================

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  google_sub   TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  picture_url  TEXT,
  role         TEXT NOT NULL DEFAULT 'student'
                 CHECK (role IN ('student', 'admin', 'superadmin')),
  telegram_id  TEXT,                    -- reserved for a deferred feature; unwritten today
  created_at   INTEGER NOT NULL
);

-- ============================================================================
-- QUIZZING — creation-time tables first, so BANK's FK targets already exist
-- ============================================================================

CREATE TABLE quiz_templates (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('verbal', 'quant', 'lr')),
  question_count   INTEGER NOT NULL CHECK (question_count > 0 AND question_count <= 100),
  difficulty_mix   TEXT NOT NULL,       -- JSON question counts by difficulty
  timing_policy    TEXT NOT NULL,       -- JSON TimingPolicy; seconds by unit kind
  slack_sec        INTEGER NOT NULL CHECK (slack_sec >= 0),
  join_window_sec  INTEGER NOT NULL CHECK (join_window_sec > 0),
  marks_correct    REAL NOT NULL CHECK (marks_correct > 0),
  marks_wrong      REAL NOT NULL CHECK (marks_wrong <= 0),
  seat_cap         INTEGER NOT NULL DEFAULT 120 CHECK (seat_cap > 0 AND seat_cap <= 120),
  rrule            TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  created_by       TEXT NOT NULL REFERENCES users(id)
);

-- Admission [scheduled_at, ends_at); preparation starts at lobby_opens_at = T-5m.
-- Each student's duration starts on their own join: started_at + window_sec*1000.
-- window_sec = SUM(quiz_units.time_limit_sec) + slack_sec; derived, never direct input.
-- Cross-table sums, unit completeness and timing_policy JSON are validated by QUIZZING.
CREATE TABLE quizzes (
  id                 TEXT PRIMARY KEY,
  quiz_number        INTEGER UNIQUE,    -- reserved on first lock attempt; exposed after successful lock
  template_id        TEXT REFERENCES quiz_templates(id),
  title              TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('verbal', 'quant', 'lr')),
  question_count     INTEGER CHECK (question_count > 0 AND question_count <= 100),
  unit_count         INTEGER CHECK (unit_count > 0),
  difficulty_mix     TEXT,
  timing_policy      TEXT,
  slack_sec          INTEGER CHECK (slack_sec >= 0),
  join_window_sec    INTEGER CHECK (join_window_sec > 0),
  scheduled_at       INTEGER NOT NULL,
  lobby_opens_at     INTEGER,
  ends_at            INTEGER,           -- scheduled_at + join_window_sec*1000
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'scheduled', 'open', 'ended', 'cancelled')),
  room_code          TEXT UNIQUE,
  seat_cap           INTEGER NOT NULL DEFAULT 120 CHECK (seat_cap > 0 AND seat_cap <= 120),
  window_sec         INTEGER CHECK (window_sec > 0),
  marks_correct      REAL CHECK (marks_correct > 0),
  marks_wrong        REAL CHECK (marks_wrong <= 0),
  created_by         TEXT NOT NULL REFERENCES users(id),
  created_at         INTEGER NOT NULL,
  opened_at          INTEGER,           -- preparation completed by openRoom
  ended_at           INTEGER,
  board_computed_at  INTEGER,           -- visible only in the commit that publishes ALL ranks
  CHECK (
    status IN ('draft', 'cancelled') OR (
      lobby_opens_at IS NOT NULL AND ends_at IS NOT NULL AND room_code IS NOT NULL AND
      quiz_number IS NOT NULL AND question_count IS NOT NULL AND unit_count IS NOT NULL AND
      timing_policy IS NOT NULL AND slack_sec IS NOT NULL AND join_window_sec IS NOT NULL AND
      window_sec IS NOT NULL AND marks_correct IS NOT NULL AND marks_wrong IS NOT NULL
    )
  ),
  CHECK (ends_at IS NULL OR ends_at = scheduled_at + join_window_sec*1000),
  CHECK (lobby_opens_at IS NULL OR lobby_opens_at = scheduled_at - 300000)
);

CREATE INDEX idx_quizzes_status ON quizzes(status);
CREATE INDEX idx_quizzes_template_id ON quizzes(template_id);
CREATE UNIQUE INDEX idx_quizzes_template_scheduled ON quizzes(template_id, scheduled_at)
  WHERE template_id IS NOT NULL;

-- ============================================================================
-- BANK — passages stores RC text AND LRDI shared material; no quiz timing here.
-- ============================================================================

CREATE TABLE passages (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('verbal', 'quant', 'lr')),
  topic           TEXT NOT NULL,
  title           TEXT,                 -- nullable: the CSV passage-row format carries no title
                                          -- column — COUNCIL_FINDINGS.md #31
  body_md         TEXT NOT NULL,        -- supports $LaTeX$, rendered client-side
  image_key       TEXT,                 -- R2 object key
  source          TEXT,
  used_in_quiz_id TEXT REFERENCES quizzes(id),   -- retired as a unit with its questions
  import_id       TEXT,                 -- BANK.md §3.3: chunked-import atomicity
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_passages_used_in_quiz_id ON passages(used_in_quiz_id);
CREATE INDEX idx_passages_import_id ON passages(import_id);

CREATE TABLE questions (
  id                   TEXT PRIMARY KEY,
  type                 TEXT NOT NULL CHECK (type IN ('verbal', 'quant', 'lr')),
  topic                TEXT NOT NULL,
  subtopic             TEXT,
  difficulty           TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
                                          -- CSV validation requires this on every questions row;
                                          -- passage rows land in `passages`, not here, so this
                                          -- rule was never actually in tension with passages
                                          -- carrying no difficulty — COUNCIL_FINDINGS.md #31
  format               TEXT NOT NULL CHECK (format IN ('mcq', 'tita')),
  passage_id           TEXT REFERENCES passages(id),   -- NULL = standalone question
  group_position       INTEGER,         -- 1..n within its passage group
  body_md              TEXT NOT NULL,   -- supports $LaTeX$
  image_key            TEXT,            -- R2 object key
  option_a             TEXT,
  option_b             TEXT,
  option_c             TEXT,
  option_d             TEXT,
  correct_option       TEXT CHECK (correct_option IN ('A', 'B', 'C', 'D')),
                                          -- 'A'..'D' for mcq — excluded from student run payloads
  numeric_answer       REAL,             -- for tita
  numeric_tolerance    REAL,
  explanation_md       TEXT NOT NULL,    -- only in admin content or unlocked student review
  source               TEXT,
  used_in_quiz_id      TEXT REFERENCES quizzes(id),   -- NULL = unused. Never repeats
  used_in_quiz_number  INTEGER,
  import_id            TEXT,             -- BANK.md §3.3: chunked-import atomicity
  created_by           TEXT NOT NULL REFERENCES users(id),
  created_at           INTEGER NOT NULL
);

CREATE INDEX idx_questions_passage_id ON questions(passage_id);
CREATE INDEX idx_questions_used_in_quiz_id ON questions(used_in_quiz_id);
-- the auto-pick hot path: WHERE used_in_quiz_id IS NULL AND type = ? AND difficulty = ?
CREATE INDEX idx_questions_unused ON questions(type, difficulty)
  WHERE used_in_quiz_id IS NULL;
CREATE INDEX idx_questions_import_id ON questions(import_id);

-- Once correct_option/numeric_answer/used_in_quiz_id are set, they are never updated again by
-- application code (BANK.md §7, resolved 2026-09-04). option_a..d freeze at the same moment, for
-- the same reason: a frozen correct answer paired with edited option text is a real bug a review
-- screen could show — COUNCIL_FINDINGS.md #20. body_md/explanation_md stay editable — there is
-- no DB-level enforcement of any of these freezes; they are application-layer rules (PATCH
-- handler checks `used_in_quiz_id IS NULL` before allowing an edit to a frozen field).
--
-- claimUnused(questionIds, quizId, quizNumber) is BANK's one write path into both this table and
-- passages: it derives each claimed question's `passage_id` and also stamps
-- `passages.used_in_quiz_id`, so a fully-retired passage is correctly excluded from later draws
-- — COUNCIL_FINDINGS.md #4 (accepted in its non-concurrent form only: no admin-concurrency race
-- handling, no all-or-nothing/auto-release machinery, since concurrent admin actions don't
-- happen in this deployment).

-- ============================================================================
-- QUIZZING — run-time and results tables
-- ============================================================================

CREATE TABLE quiz_units (
  quiz_id         TEXT NOT NULL REFERENCES quizzes(id),
  unit_position   INTEGER NOT NULL CHECK (unit_position > 0),
  kind            TEXT NOT NULL CHECK (kind IN ('standalone', 'rc', 'lrdi')),
  passage_id      TEXT REFERENCES passages(id),
  time_limit_sec  INTEGER CHECK (time_limit_sec > 0), -- nullable draft; required at lock
  PRIMARY KEY (quiz_id, unit_position),
  UNIQUE (quiz_id, passage_id),
  CHECK ((kind = 'standalone' AND passage_id IS NULL) OR
         (kind IN ('rc', 'lrdi') AND passage_id IS NOT NULL))
);

CREATE TABLE quiz_questions (
  quiz_id        TEXT NOT NULL REFERENCES quizzes(id),
  question_id    TEXT NOT NULL REFERENCES questions(id),
  position       INTEGER NOT NULL CHECK (position > 0), -- flat graded question identity
  unit_position  INTEGER NOT NULL,
  sub_position   INTEGER NOT NULL CHECK (sub_position > 0),
  PRIMARY KEY (quiz_id, position),
  UNIQUE (quiz_id, question_id),
  UNIQUE (quiz_id, unit_position, sub_position),
  UNIQUE (quiz_id, position, question_id, unit_position),
  FOREIGN KEY (quiz_id, unit_position) REFERENCES quiz_units(quiz_id, unit_position)
);
-- QUIZZING validates contiguous positions, one question per standalone, and complete
-- 4-5-question passage membership at lock. "1.2" is display text, never a decimal ID.

CREATE TABLE quiz_seats (
  quiz_id     TEXT NOT NULL REFERENCES quizzes(id),
  seat_no     INTEGER NOT NULL,
  user_id     TEXT REFERENCES users(id),
  claimed_at  INTEGER,
  PRIMARY KEY (quiz_id, seat_no),
  UNIQUE (quiz_id, user_id)   -- AUDIT.md §2.2: stops one user winning two seats when the
                              -- conditional UPDATE seat-claim is retried. join() must treat a
                              -- constraint hit on this index as "you already have a seat, here it
                              -- is" rather than an error — COUNCIL_FINDINGS.md #14
);

-- Self-paced: unit 1 starts with the student's join. Progress is server-side by UNIT;
-- the selected subquestion and editable answers are browser-local drafts only.
CREATE TABLE participants (
  quiz_id                TEXT NOT NULL REFERENCES quizzes(id),
  user_id                TEXT NOT NULL REFERENCES users(id),
  seat_no                INTEGER NOT NULL,
  started_at             INTEGER NOT NULL,
  current_unit_position  INTEGER NOT NULL DEFAULT 1 CHECK (current_unit_position > 0),
  finished_at            INTEGER,
  total_score            REAL NOT NULL DEFAULT 0, -- updated once per committed unit batch
  correct_count          INTEGER NOT NULL DEFAULT 0,
  wrong_count            INTEGER NOT NULL DEFAULT 0,
  skipped_count          INTEGER NOT NULL DEFAULT 0, -- explicit skips only
  unanswered_count       INTEGER NOT NULL DEFAULT 0, -- timeout/unreached, finalized at finish
  total_time_ms          INTEGER NOT NULL DEFAULT 0, -- sum of closed reached units, counted once
  rank                   INTEGER,
  PRIMARY KEY (quiz_id, user_id)
);
CREATE INDEX idx_participants_quiz_rank ON participants(quiz_id, rank);
CREATE INDEX idx_participants_user_id ON participants(user_id);

-- Insert before serving a unit. No per-answer writes while the student is navigating it.
-- deadline_at = MIN(started_at + unit.time_limit_sec*1000, participant overall deadline).
-- submit_by_at = deadline_at + 5000 in V1. Editing freezes at deadline_at; the difference is
-- transport time only. Both timestamps are fixed when the unit is opened.
CREATE TABLE participant_units (
  quiz_id         TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  unit_position   INTEGER NOT NULL,
  started_at      INTEGER NOT NULL,
  deadline_at     INTEGER NOT NULL,
  submit_by_at    INTEGER NOT NULL,
  closed_at       INTEGER,             -- actual server finalization time
  close_reason    TEXT CHECK (close_reason IN ('completed', 'timed_out')),
  elapsed_ms      INTEGER,             -- server elapsed, capped at deadline_at-started_at
  submission_id   TEXT,                -- client-generated retry key; NULL on server-only expiry
  payload_hash    TEXT,                -- canonical validated batch hash for changed-retry detection
  PRIMARY KEY (quiz_id, user_id, unit_position),
  UNIQUE (quiz_id, user_id, submission_id),
  FOREIGN KEY (quiz_id, user_id) REFERENCES participants(quiz_id, user_id),
  FOREIGN KEY (quiz_id, unit_position) REFERENCES quiz_units(quiz_id, unit_position),
  CHECK (deadline_at >= started_at AND submit_by_at = deadline_at + 5000),
  CHECK ((submission_id IS NULL) = (payload_hash IS NULL)),
  CHECK ((closed_at IS NULL AND close_reason IS NULL AND elapsed_ms IS NULL) OR
         (closed_at IS NOT NULL AND close_reason IS NOT NULL AND elapsed_ms IS NOT NULL AND
          closed_at >= started_at AND elapsed_ms >= 0 AND elapsed_ms <= deadline_at-started_at))
);
CREATE UNIQUE INDEX idx_participant_units_one_active ON participant_units(quiz_id, user_id)
  WHERE closed_at IS NULL;

-- Final responses only. All rows for a submitted unit, its closure, participant totals,
-- and the next-unit start (or finish) commit atomically. No per-question timing is collected.
CREATE TABLE answers (
  quiz_id        TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  question_id    TEXT NOT NULL,
  position       INTEGER NOT NULL,
  unit_position  INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('answered', 'skipped', 'unanswered')),
  chosen_option  TEXT CHECK (chosen_option IN ('A', 'B', 'C', 'D')),
  numeric_value  REAL,
  is_correct     INTEGER CHECK (is_correct IN (0, 1)),
  marks          REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (quiz_id, user_id, position),
  FOREIGN KEY (quiz_id, user_id, unit_position)
    REFERENCES participant_units(quiz_id, user_id, unit_position),
  FOREIGN KEY (quiz_id, position, question_id, unit_position)
    REFERENCES quiz_questions(quiz_id, position, question_id, unit_position),
  CHECK ((status = 'answered' AND is_correct IS NOT NULL AND
          ((chosen_option IS NOT NULL AND numeric_value IS NULL) OR
           (chosen_option IS NULL AND numeric_value IS NOT NULL))) OR
         (status IN ('skipped', 'unanswered') AND chosen_option IS NULL AND
          numeric_value IS NULL AND is_correct IS NULL AND marks = 0))
);
CREATE INDEX idx_answers_question_id ON answers(question_id);
-- A missing answer row means no accepted batch response, NOT necessarily "never seen".
-- participant_units distinguishes an expired served unit from an unreached unit.
-- Server-only expiry need not insert zero-answer rows; unreached units have no runtime rows.

-- week_start is IST-anchored (Asia/Kolkata), not UTC: the weekly cron fires after the IST week
-- has actually ended, so a quiz run late Sunday IST still lands in the week it belongs to —
-- COUNCIL_FINDINGS.md #15. See SCHEDULER.md for the cron expression and weekStart derivation.
-- Rank uses total_score across quizzes taken; quizzes_taken is context, not a divisor/tie-break.
-- Exact total-score ties share a dense rank.
CREATE TABLE weekly_boards (
  week_start     TEXT NOT NULL,         -- ISO date, Monday of the week in Asia/Kolkata (IST)
  type           TEXT NOT NULL CHECK (type IN ('verbal', 'quant', 'lr', 'overall')),
  user_id        TEXT NOT NULL REFERENCES users(id),
  quizzes_taken  INTEGER NOT NULL,
  total_score    REAL NOT NULL,
  rank           INTEGER NOT NULL,
  PRIMARY KEY (week_start, type, user_id)
);

-- ============================================================================
-- TELEGRAM
-- ============================================================================

-- Idempotency is "claim the row, then send": insert with status='pending' before calling the
-- Bot API, then UPDATE to 'sent'/'failed' after. message_id/sent_at are only known after a send
-- succeeds, so they can't be NOT NULL the way the original schema had them —
-- COUNCIL_FINDINGS.md #1. claimed_at is the one timestamp guaranteed to exist from the start.
CREATE TABLE telegram_posts (
  quiz_id     TEXT REFERENCES quizzes(id),   -- NULL for weekly posts
  kind        TEXT NOT NULL
                CHECK (kind IN ('announce', 'soon', 'open', 'result', 'weekly', 'cancelled')),
  week_start  TEXT,                          -- set for 'weekly'
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed')),
  message_id  TEXT,                          -- NULL until status='sent'
  error       TEXT,                          -- set when status='failed'
  claimed_at  INTEGER NOT NULL,               -- when this row was inserted (the claim)
  sent_at     INTEGER,                        -- NULL until status='sent'
  UNIQUE (quiz_id, kind),
  UNIQUE (week_start, kind)
);
