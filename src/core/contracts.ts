// V1 contracts, revised 2026-09-09. Narrative: CONTRACTS.md, QUIZZING.md.
// Definitions only; zero platform imports. HTTP shapes live in core/api.ts.

export type QuizType = 'verbal' | 'quant' | 'lr'
export type QuizStatus = 'draft' | 'scheduled' | 'open' | 'ended' | 'cancelled'
export type Role = 'student' | 'admin' | 'superadmin'
export type Difficulty = 'easy' | 'medium' | 'hard'
export type QuestionFormat = 'mcq' | 'tita'
export type UnitKind = 'standalone' | 'rc' | 'lrdi'

export type CurrentUser = {
  id: string
  name: string
  role: Role
  pictureUrl: string | null
}

export interface AuthContract {
  requireAuth(): void
  requireRole(role: 'admin' | 'superadmin'): void
  currentUser(ctx: unknown): CurrentUser
  getUserById(id: string): Promise<CurrentUser | null>
}

// BANK owns content and grouping. "passage" also represents LRDI shared material.
// The existing section determines group kind: verbal -> rc; quant/lr -> lrdi.
export type PassageContent = {
  title: string | null
  bodyMd: string
  imageUrl: string | null
}

// Full content is permitted in admin responses and unlocked participant reviews only.
export type QuestionFull = {
  id: string
  type: QuizType
  topic: string
  subtopic: string | null
  difficulty: Difficulty
  format: QuestionFormat
  passageId: string | null
  groupPosition: number | null
  bodyMd: string
  imageUrl: string | null
  optionA: string | null
  optionB: string | null
  optionC: string | null
  optionD: string | null
  correctOption: 'A' | 'B' | 'C' | 'D' | null
  numericAnswer: number | null
  numericTolerance: number | null
  explanationMd: string
  source: string | null
  usedInQuizId: string | null
  passage: PassageContent | null
}

export type SelectionFilters = {
  type: QuizType
  difficultyMix: Partial<Record<Difficulty, number>>
  count: number // graded questions, not timed units
}

export interface BankContract {
  listUnused(filters: SelectionFilters): Promise<QuestionFull[]>
  // Marks questions and fully claimed passages; never releases retired content. Idempotent for
  // requested ids already owned by the same quizId/quizNumber: those ids count as confirmed.
  // Concurrent-admin all-or-nothing claims remain outside the accepted scope.
  claimUnused(questionIds: string[], quizId: string, quizNumber: number): Promise<string[]>
  getByIds(questionIds: string[]): Promise<QuestionFull[]>
}

// QUIZZING applies these defaults to the actual draw, including recurring occurrences.
// Required only for kinds present in a draw. Values are positive integer seconds.
export type TimingPolicy = Partial<Record<UnitKind, number>>
export type QuizUnitDefinition = {
  unitPosition: number // integer, 1-based
  kind: UnitKind
  passageId: string | null
  questionPositions: number[] // immutable flat integer positions within this quiz
  timeLimitSec: number | null // unset until configured; required at lock
}

// Redacted question inside the active unit; no per-question clock.
export type ServedQuestion = {
  position: number // flat answer identity, independent of display label
  subPosition: number // 1-based within unit; display "2.3", never store decimal IDs
  format: QuestionFormat
  bodyMd: string
  imageUrl: string | null
  options: [string, string, string, string] | null
}

// Safe shared KV payload. No participant timestamps or unpublished solutions.
export type UnitContent = {
  unitPosition: number
  unitCount: number
  questionCount: number // quiz-wide graded question count
  kind: UnitKind
  timeLimitSec: number
  passage: PassageContent | null
  questions: ServedQuestion[] // THIS unit only; never a future unit
}

// Participant metadata is read from D1, never shared through the content cache.
export type ServedUnit = UnitContent & {
  startedAt: number
  deadlineAt: number // editing stops; capped at participant's overall deadline
  submitByAt: number // deadlineAt + 5,000 ms; transport only, never extra editing time
}

export type UnitAnswer =
  | { position: number; status: 'answered'; format: 'mcq'; chosenOption: 'A' | 'B' | 'C' | 'D' }
  | { position: number; status: 'answered'; format: 'tita'; numericValue: number }
  | { position: number; status: 'skipped' }
  | { position: number; status: 'unanswered' } // timeout submission only

export type UnitCloseReason = 'completed' | 'timed_out'
export type OpenResult = { seatsSeeded: number; alreadyOpen: boolean }
export type LeaderboardRow = { rank: number; userId: string; name: string; score: number }
export type CloseResult = {
  participantCount: number
  top10: LeaderboardRow[]
  boardComputedAt: number
}
export type DueCloseQuiz = { quizId: string; safeCloseAt: number }
export type MaterializationFailure = {
  templateId: string
  scheduledAt: number
  code: 'pool_exhausted' | 'missing_timing_configuration'
}
export type MaterializeResult = { quizIds: string[]; failures: MaterializationFailure[] }
export type WeeklyBoardRow = {
  rank: number
  userId: string
  name: string
  totalScore: number
  quizzesTaken: number
}
export type BoardSummary = {
  type: QuizType | 'overall'
  weekStart: string
  top10: WeeklyBoardRow[]
}

// SCHEDULER orchestrates. All D1/KV effects occur inside these module calls.
export interface QuizzingSchedulerContract {
  // Read-only discovery owned by QUIZZING; SCHEDULER never queries D1 itself.
  listDuePrepare(now: number, limit: number): Promise<string[]>
  listDueClose(now: number, limit: number): Promise<DueCloseQuiz[]>
  // Due, not-yet-claimed TG-1/TG-2/TG-3 announcements — CONTRACTS.md §5.
  listDueAnnounce(now: number, limit: number): Promise<DueAnnounceQuiz[]>
  openRoom(quizId: string, now: number): Promise<OpenResult>
  // Finalize unresolved runs, rank stored totals, publish completion atomically.
  // Never expose boardComputedAt while ranks are only partially written.
  closeQuiz(quizId: string, now: number): Promise<CloseResult>
  materializeTemplates(days: number, now: number): Promise<MaterializeResult>
  // [] means the week is not ready; four summaries (possibly empty boards) mean published.
  computeWeeklyBoards(weekStart: string): Promise<BoardSummary[]>
}

export type TelegramPostKind = 'announce' | 'soon' | 'open' | 'result' | 'weekly' | 'cancelled'
export type ClaimAndSendResult = { sent: boolean; skipped: boolean }
export type FailedTelegramPostRef = {
  quizId: string | null
  weekStart: string | null
  kind: TelegramPostKind
  claimedAt: number
}
export type QuizAnnouncePayload = {
  title: string
  scheduledAt: number
  endsAt: number // admission cutoff, not a student's finish time
  questionCount: number
  unitCount: number
  windowSec: number // each student's duration
  timingSummary: { kind: UnitKind; count: number; minTimeSec: number; maxTimeSec: number }[]
  roomCode?: string // only released at scheduledAt, including in delayed open posts
}
// Which of TG-1/TG-2/TG-3 is due, plus the exact payload to render it — CONTRACTS.md §5.
export type DueAnnounceQuiz = { quizId: string; kind: 'announce' | 'soon' | 'open' } & QuizAnnouncePayload
export type CancelledPayload = { title: string; scheduledAt: number; reason?: string }
export type TelegramPayload = QuizAnnouncePayload | CloseResult | BoardSummary[] | CancelledPayload
export interface TelegramContract {
  // Read-only discovery owned by TELEGRAM for SCHEDULER failure alerts.
  listFailedPosts(limit: number): Promise<FailedTelegramPostRef[]>
  claimAndSend(
    kind: TelegramPostKind,
    target: { quizId: string } | { weekStart: string },
    payload: TelegramPayload
  ): Promise<ClaimAndSendResult>
}
