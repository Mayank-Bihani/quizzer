// Revised 2026-09-09: timed units, batch submission, marks-only V1.
// core/api.ts — the HTTP request/response shape for every route in the system.
// Narrative version, with the reasoning behind each shape: API.md.
// Reuses core/contracts.ts wherever a field already exists there; never redefines one.
//
// Convention (API.md, CONTRACTS.md §7): every error response, any status code, is
// `{ message: string }` — that type is not repeated per route below. Every success response is
// the payload directly, no envelope. Routes with no body and no meaningful query params have no
// Request type (see API.md's skip list for why each one qualifies).

import type {
  QuizType,
  QuizStatus,
  Role,
  Difficulty,
  QuestionFormat,
  CurrentUser,
  QuestionFull,
  SelectionFilters,
  ServedUnit,
  TimingPolicy,
  QuizUnitDefinition,
  UnitAnswer,
  UnitCloseReason,
  LeaderboardRow,
  WeeklyBoardRow,
} from './contracts'

// ============================================================================
// Shared error shape (documented here, not re-exported per route)
// ============================================================================

export type ApiError = { message: string }

// ============================================================================
// Pagination — the one convention, applied identically to every list route that can grow
// without bound (BANK-8 browse, RESULT-8 history, BOARD-8 weekly board, the admin report's
// participant list). Bounded-size lists (leaderboard ≤ seat_cap, review ≤ question_count,
// the admin roster, the open-quiz list) are returned as plain arrays — see API.md.
// Defaults: limit=50, offset=0. limit must be an integer in 1..100 and offset must be a
// non-negative integer; invalid values return 400 and are never silently clamped.
// ============================================================================

export type PageRequest = {
  limit?: number
  offset?: number
}

export type PageResponse<T> = {
  items: T[]
  total: number
  limit: number
  offset: number
}

// ============================================================================
// Shapes with no existing home in contracts.ts, built once here and reused across routes.
// contracts.ts is module-to-module and has no full admin-facing Quiz or Passage type — these
// are HTTP-surface types, assembled only from columns in migrations/0001_init.sql.
// ============================================================================

// Nullable settings may be unset in drafts and cancelled drafts — everything is set together the
// moment a quiz is locked (COUNCIL_FINDINGS.md #2/#3/#5/#36; see migrations/0001_init.sql's CHECK
// on `quizzes`). `endsAt` here means "join window closes", not a shared quiz cutoff — this is a
// self-paced quiz; each student's own deadline is their own join time + windowSec
// (COUNCIL_FINDINGS.md #6).
export type QuizAdminSummary = {
  id: string
  quizNumber: number | null
  templateId: string | null
  title: string
  type: QuizType
  questionCount: number | null
  difficultyMix: Partial<Record<Difficulty, number>> | null
  scheduledAt: number
  lobbyOpensAt: number | null
  endsAt: number | null
  status: QuizStatus
  roomCode: string | null
  seatCap: number
  unitCount: number | null
  units: QuizUnitDefinition[]
  timingPolicy: TimingPolicy | null
  joinWindowSec: number | null
  slackSec: number | null
  windowSec: number | null
  marksCorrect: number | null
  marksWrong: number | null
  createdAt: number
  openedAt: number | null
  endedAt: number | null
  boardComputedAt: number | null
}

export type PassageSummary = {
  id: string
  type: QuizType
  topic: string
  title: string | null   // nullable — the CSV passage-row format carries no title column
                          // (COUNCIL_FINDINGS.md #31)
  bodyMd: string
  imageUrl: string | null
  source: string | null
  usedInQuizId: string | null
}

export type ImportCounts = {
  questions: number
  passages: number                              // total passage rows — a passage row isn't a
                                                  // `questions` row, so it's never inside byFormat
  byType: Record<QuizType, number>
  byFormat: Record<QuestionFormat, number>        // mcq/tita only, by design (COUNCIL_FINDINGS.md #39)
}

export type PassageGroupSummary = { passageId: string; size: number }

export type ImportRowError = { line: number; message: string }

// ============================================================================
// AUTH — AUTH.md §5
// ============================================================================

export type GoogleSignInRequest = { idToken: string }
export type GoogleSignInResponse = CurrentUser
// Session is set as an HttpOnly cookie, a side effect — not part of the body.

// POST /api/auth/logout — no body
export type LogoutResponse = { success: true }

// GET /api/auth/me — no body, no query params
export type GetMeResponse = CurrentUser

// GET /api/admin/users — no body; roster is not one of the four named pagination routes
export type AdminUserSummary = CurrentUser & { email: string; createdAt: number }
export type AdminListUsersResponse = { users: AdminUserSummary[] }

export type SetUserRoleRequest = { role: Role }
export type SetUserRoleResponse = AdminUserSummary

// ============================================================================
// BANK — BANK.md §5
// ============================================================================

// POST /api/bank/import/preview — multipart/form-data (CSV + optional companion ZIP), not a
// JSON body. No Request type: there is no JSON-typeable field to describe.
export type ImportPreviewResponse = {
  counts: ImportCounts
  passageGroups: PassageGroupSummary[]
  errors: ImportRowError[]
}

// POST /api/bank/import/commit — same multipart shape as preview, no Request type.
// importId is null when errors is non-empty: BANK-7's atomicity means a failed import writes
// nothing, so there is nothing to key by import_id.
export type ImportCommitResponse = {
  importId: string | null
  counts: ImportCounts
  errors: ImportRowError[]
}

export type ListQuestionsRequest = PageRequest & {
  type?: QuizType
  topic?: string
  difficulty?: Difficulty
  used?: boolean
  passageId?: string
}
// QuestionFull (correctOption, explanationMd included) is safe here — AUDIT.md §11 decision 17:
// admin-role holders already author and know the answer, so this is not a student-facing leak.
export type ListQuestionsResponse = PageResponse<QuestionFull>

// GET /api/bank/questions/:id — no body
export type GetQuestionResponse = QuestionFull

export type UpdateQuestionRequest = Partial<
  Pick<
    QuestionFull,
    | 'topic'
    | 'subtopic'
    | 'difficulty'
    | 'bodyMd'
    | 'optionA'
    | 'optionB'
    | 'optionC'
    | 'optionD'
    | 'numericTolerance'
    | 'explanationMd'
    | 'source'
  >
>
// Deliberately excludes correctOption, numericAnswer, and the used-question identity — BANK.md §6:
// those freeze forever once a question is used. optionA..D are type-permitted here (still
// editable before use, e.g. fixing a typo) but the handler must reject an edit to any of them
// once `used_in_quiz_id IS NOT NULL`, the same freeze point as correctOption — a frozen correct
// answer paired with edited option text is exactly the bug this closes (COUNCIL_FINDINGS.md #20).
// `imageUrl` is excluded: it's derived server-side from the stored `image_key`, never accepted as
// input (COUNCIL_FINDINGS.md #27) — replacing an image is a dedicated upload flow, not this PATCH.
// `format`/`type`/`passageId`/`groupPosition` are structural identity set at import and not
// offered here either.
export type UpdateQuestionResponse = QuestionFull

// DELETE /api/bank/questions/:id — no body
export type DeleteQuestionResponse = { success: true }

// GET /api/bank/passages — no filters documented, no Request type
export type ListPassagesResponse = { passages: PassageSummary[] }

// GET /api/images/:key — serves the raw R2 object with its stored content type. Binary
// passthrough, not a JSON contract: no Request or Response type. Not part of BANK's admin-only
// route group despite living under /api — requireAuth() only (any signed-in user), no
// per-question scoping: these are illustrative images, not answers, and scoping would require
// BANK to read QUIZZING's tables for no real benefit (COUNCIL_FINDINGS.md #11, reconsidered).

// ============================================================================
// QUIZZING — creation (QUIZZING.md §4)
// ============================================================================

// GET /api/admin/quizzes — the only way to recover a draft's id after leaving and coming back;
// nothing else returns QuizAdminSummary except PATCH and cancel, both of which require already
// knowing the id (COUNCIL_FINDINGS.md #18, un-bundled from the recurring-template deferral).
// Paginated: every quiz ever created stays in `quizzes` forever, so this grows without bound.
export type ListQuizzesRequest = PageRequest & { status?: QuizStatus }
export type ListQuizzesResponse = PageResponse<QuizAdminSummary>

// Creates a 'draft' quiz row — quizNumber and roomCode aren't assigned yet (that happens at
// lock, QUIZZING.md §4 step 7 — COUNCIL_FINDINGS.md #36), and scoring/timing params are deferred
// to the later PATCH (COUNCIL_FINDINGS.md #2/#3). question_count/difficultyMix are stored from
// SelectionFilters at draft time so reshuffle and the window derivation have something to read
// (COUNCIL_FINDINGS.md #5).
// Manual mode (Sprint 10): the admin hand-picks exact questionIds instead of a difficultyMix/count
// target; questionCount/difficultyMix are derived server-side from what was actually picked
// (QUIZZING.md §4, "manual selection").
export type CreateQuizDraftRequest =
  | (SelectionFilters & { title: string; scheduledAt: number; mode?: 'auto' })
  | { title: string; scheduledAt: number; type: QuizType; mode: 'manual'; questionIds: string[] }
export type CreateQuizDraftResponse = {
  quizId: string
  status: 'draft'
  questionCount: number
  unitCount: number
  units: QuizUnitDefinition[]
  questions: QuestionFull[]
}

// POST /api/admin/quizzes/:id/reshuffle — no body, redraws with the same stored parameters
// (SelectionFilters, now stored on the quiz row itself — COUNCIL_FINDINGS.md #5)
export type ReshuffleQuizResponse = {
  questions: QuestionFull[]
  units: QuizUnitDefinition[]
  unitCount: number
  windowSec: number | null
}

// POST /api/admin/quizzes/:id/lock — no body. The first lock attempt may reserve quizNumber
// internally because BANK requires it while claiming. Draft responses keep it hidden until
// roomCode is assigned and scheduling succeeds; abandoned reservations may leave number gaps.
export type LockQuizResponse =
  | { locked: true; roomCode: string; quizNumber: number }
  | { locked: false; requestedCount: number; claimedCount: number }

export type UpdateQuizParamsRequest = Partial<{
  title: string
  scheduledAt: number
  joinWindowSec: number
  timingPolicy: TimingPolicy
  // Explicit overrides for the current draw; each position must exist and appear once.
  unitTimeLimits: { unitPosition: number; timeLimitSec: number }[]
  slackSec: number
  marksCorrect: number
  marksWrong: number
  seatCap: number
}>
// windowSec is derived from SUM(unit allowances) + slackSec; never accepted as input.
// timingPolicy changes reapply defaults to all units, then unitTimeLimits overrides apply.
// Reshuffle discards overrides and uses the stored policy. All timing freezes at room open.
// endsAt = scheduledAt + joinWindowSec*1000; lobbyOpensAt = scheduledAt - 300000.
export type UpdateQuizParamsResponse = QuizAdminSummary

// POST /api/admin/quizzes/:id/cancel — no body
export type CancelQuizResponse = QuizAdminSummary

// ============================================================================
// QUIZZING — templates (QUIZZING.md §4.4; API.md "QUIZZING — templates")
// ============================================================================

// Admin-facing recurring template row. Unlike QuizAdminSummary's fields, a template's
// difficultyMix/timingPolicy/rrule columns are NOT NULL (migrations/0001_init.sql:41-56), so they
// are typed non-nullable here rather than reusing QuizAdminSummary's nullable variants.
export type TemplateSummary = {
  id: string
  name: string
  type: QuizType
  questionCount: number
  difficultyMix: Partial<Record<Difficulty, number>>
  timingPolicy: TimingPolicy
  slackSec: number
  joinWindowSec: number
  marksCorrect: number
  marksWrong: number
  seatCap: number
  rrule: string
  active: boolean
}

export type CreateTemplateRequest = {
  name: string
  type: QuizType
  questionCount: number
  difficultyMix: Partial<Record<Difficulty, number>>
  timingPolicy: TimingPolicy
  slackSec: number
  joinWindowSec: number
  marksCorrect: number
  marksWrong: number
  seatCap: number
  rrule: string
}
export type CreateTemplateResponse = TemplateSummary

// GET /api/admin/templates — bare PageRequest; no status/active/type filter is named anywhere in
// API.md's route table, and the list includes both active and inactive rows (each carries
// `active`) so an admin can still see a deactivated template without one.
export type ListTemplatesRequest = PageRequest
export type ListTemplatesResponse = PageResponse<TemplateSummary>

export type UpdateTemplateRequest = Partial<CreateTemplateRequest>
export type UpdateTemplateResponse = TemplateSummary

// POST /api/admin/templates/:id/deactivate — no body
export type DeactivateTemplateResponse = TemplateSummary

// ============================================================================
// QUIZZING — the run (QUIZZING.md §5)
// ============================================================================

// endsAt here means "join window closes" — self-paced quiz, no shared start (COUNCIL_FINDINGS.md #6)
export type OpenQuizSummary = {
  id: string
  quizNumber: number
  title: string
  type: QuizType
  roomCode: string
  scheduledAt: number
  endsAt: number
}
// GET /api/quizzes/open — no body; bounded by how many quizzes are open at once, not paginated
export type ListOpenQuizzesResponse = { quizzes: OpenQuizSummary[] }

// A scheduled quiz within UPCOMING_QUIZ_WINDOW_MS of scheduledAt — no roomCode, since joining is
// impossible before scheduledAt regardless (QUIZZING.md §5). Fallback discovery, not a teaser reveal.
export type UpcomingQuizSummary = {
  id: string
  quizNumber: number
  title: string
  type: QuizType
  questionCount: number
  scheduledAt: number
}
// GET /api/quizzes/upcoming — no body; bounded by the lookahead window, not paginated
export type ListUpcomingQuizzesResponse = { quizzes: UpcomingQuizSummary[] }

export type QuizMeta = {
  quizId: string
  quizNumber: number
  title: string
  type: QuizType
  questionCount: number
  unitCount: number
  endsAt: number // admission cutoff
  windowSec: number
  startedAt: number // student's own quiz start
  deadlineAt: number // startedAt + windowSec*1000
}

// serverNow is refreshed on every response; immutable unit timestamps never restart on retry.
export type PlayState =
  | { status: 'active'; serverNow: number; unit: ServedUnit }
  | { status: 'finished'; serverNow: number; totalScore: number; answeredCount: number }

// POST /api/quizzes/:code/join. Existing participants resume even after admission closes.
export type JoinQuizResponse = { meta: QuizMeta; state: PlayState }
// GET /api/play/:quizId/current. Includes shared passage/image and every active-unit question.
export type CurrentUnitResponse = { meta: QuizMeta; state: PlayState }

// POST /api/play/:quizId/units/:unitPosition/submit
// Complete: exactly one answered/skipped entry for EVERY question. Timeout: unresolved
// entries may be 'unanswered'. Never accept an answer position from another unit.
export type SubmitUnitRequest = {
  submissionId: string
  reason: 'complete' | 'timeout'
  answers: UnitAnswer[]
}
export type SubmitUnitResponse = {
  closedUnit: { unitPosition: number; reason: UnitCloseReason }
  state: PlayState
}
// Identical accepted retries acknowledge the same closure and return CURRENT authoritative
// state, not a stale next-unit payload. Changed payload/key for a closed unit is 409.
// No per-question answer/skip routes: editing, Back and Skip are local until set closure.

// GET /api/play/:quizId/status — finished participants only; 409 while still playing.
export type PlayStatusResponse = {
  totalScore: number
  answeredCount: number
  finishedCount: number
  participantCount: number
  estimatedUnlockAt: number // hint only; actual results gate is board_computed_at
}

// ============================================================================
// QUIZZING — results (QUIZZING.md §6)
// ============================================================================

export type LeaderboardRowView = LeaderboardRow & { isOwnRow: boolean }
// GET /api/quizzes/:quizId/leaderboard — no body; 423 until board_computed_at is set.
// Top 10 plus the viewing student's own row if they're outside it — `rows` is never the full
// board, and `isOwnRow` disambiguates rank 11 from "your row" when both could otherwise look like
// an ordinary entry (COUNCIL_FINDINGS.md #34).
export type LeaderboardResponse = {
  participantCount: number
  boardComputedAt: number
  truncated: boolean   // true whenever the full board has more entries than `rows` contains
  rows: LeaderboardRowView[]
}

export type McqDistribution = {
  participantCount: number
  optionCounts: Record<'A' | 'B' | 'C' | 'D', number>
  notAnsweredCount: number
}

export type QuestionReviewRow = {
  position: number
  unitPosition: number
  subPosition: number
  outcome: 'correct' | 'wrong' | 'skipped' | 'unanswered' | 'not_reached'
  question: Pick<
    QuestionFull,
    | 'bodyMd'
    | 'imageUrl'
    | 'format'
    | 'optionA'
    | 'optionB'
    | 'optionC'
    | 'optionD'
    | 'correctOption'
    | 'numericAnswer'
    | 'numericTolerance'
    | 'explanationMd'
    | 'passage'
  >
  // null when no final answer row exists. Unit runtime state distinguishes timeout
  // from an unreached unit; absence alone does not mean the question was never seen.
  yourAnswer: {
    chosenOption: string | null
    numericValue: number | null
    isCorrect: boolean | null
    marks: number
  } | null
  // MCQ only. Counts cover the whole participant room and are the canonical source from which
  // the client derives percentages. notAnsweredCount includes skipped, unanswered/unsubmitted,
  // and unreached responses. Option counts + notAnsweredCount must equal participantCount.
  distribution: McqDistribution | null
}
// GET /api/quizzes/:quizId/review — no body; 423 until board_computed_at is set.
// correctOption/explanationMd/numericAnswer (QuestionFull's redacted-during-a-run fields) appear
// here only because this route fires exclusively after board_computed_at — never during a run.
export type UnitReviewTiming = {
  unitPosition: number
  closeReason: UnitCloseReason | null // null when never reached
  elapsedMs: number | null
  roomAvgElapsedMs: number | null // reached, finalized units only; counted once per unit
}
export type ReviewResponse = { rows: QuestionReviewRow[]; units: UnitReviewTiming[] }

export type HistoryEntry = {
  quizId: string
  quizNumber: number
  title: string
  type: QuizType
  scheduledAt: number
  totalScore: number | null // null until this participant finishes
  rank: number | null
  participantCount: number | null
}
export type HistoryRequest = PageRequest
export type HistoryResponse = PageResponse<HistoryEntry>

export type WeeklyBoardRequest = PageRequest & {
  weekStart?: string
  type?: QuizType | 'overall'
}
export type WeeklyBoardResponse = PageResponse<WeeklyBoardRow> & {
  weekStart: string
  type: QuizType | 'overall'
}

export type MonthlyBoardRequest = PageRequest & {
  monthStart?: string
  type?: QuizType | 'overall'
}
export type MonthlyBoardResponse = PageResponse<WeeklyBoardRow> & {
  monthStart: string
  type: QuizType | 'overall'
}

// ============================================================================
// QUIZZING — admin report export (QUIZZING.md §7)
// ============================================================================

export type AdminReportParticipantRow = {
  userId: string
  name: string
  seatNo: number
  totalScore: number
  correctCount: number
  wrongCount: number
  skippedCount: number
  unansweredCount: number
  totalTimeMs: number
  rank: number | null
}

export type AdminReportQuestionRow = {
  position: number
  unitPosition: number
  subPosition: number
  questionId: string
  correctCount: number
  wrongCount: number
  skippedCount: number
  unansweredCount: number
}

export type AdminReportRequest = PageRequest
export type AdminReportResponse = {
  quizId: string
  participants: PageResponse<AdminReportParticipantRow>
  questions: AdminReportQuestionRow[]
  units: { unitPosition: number; completedCount: number; timedOutCount: number; avgElapsedMs: number | null }[]
}
