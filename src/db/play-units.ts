// Conditional unit closure: a standalone conditional UPDATE first proves exclusive ownership of
// the receipt, then one unconditional batch commits answers + participant aggregates + the
// next-unit-or-finish transition — QUIZZING.md §5; AC-9/10/11/12 (Sprint 4 packet).

export type AnswerWrite = {
  questionId: string
  position: number
  status: "answered" | "skipped" | "unanswered"
  chosenOption: "A" | "B" | "C" | "D" | null
  numericValue: number | null
  isCorrect: boolean | null
  marks: number
}

export type AggregateDelta = {
  scoreDelta: number
  correctDelta: number
  wrongDelta: number
  skippedDelta: number
  unansweredDelta: number
}

export type CloseUnitInput = {
  quizId: string
  userId: string
  unitPosition: number
  closedAt: number
  closeReason: "completed" | "timed_out"
  elapsedMs: number
  submissionId: string | null // null only for server-only expiry settlement
  payloadHash: string | null
  answers: AnswerWrite[]
  aggregateDelta: AggregateDelta
  next: { unitPosition: number; startedAt: number; deadlineAt: number; submitByAt: number } | null
  finish: boolean // mutually exclusive with `next`
}

export type CloseUnitOutcome = "closed" | "lost_race"

// Two phases, not one batch. A value-match guard (e.g. "does this row now hold exactly the
// closedAt/submissionId/payloadHash I just tried to write") cannot tell a genuine winner apart
// from a concurrent caller submitting the IDENTICAL retry — both would see the row matching
// their own bound values, since a winning identical retry writes the same values a loser also
// would have. D1/SQLite serializes writes, so this standalone conditional UPDATE is the only
// statement that can distinguish them: exactly one concurrent caller ever observes changes===1.
// Only that proven winner proceeds to the second, now-unconditional batch. The gap between the
// two calls is the accepted tradeoff (matching this codebase's existing reserve/claim/publish
// precedent in db/quizzes.ts): a crash in that gap leaves the unit closed with no answers yet,
// recoverable only by a reviewed forward repair, never by re-running this function blindly.
export async function closeUnitAtomic(db: D1Database, input: CloseUnitInput): Promise<CloseUnitOutcome> {
  const { quizId, userId, unitPosition } = input

  const closeResult = await db
    .prepare(
      `UPDATE participant_units
       SET closed_at = ?, close_reason = ?, elapsed_ms = ?, submission_id = ?, payload_hash = ?
       WHERE quiz_id = ? AND user_id = ? AND unit_position = ? AND closed_at IS NULL`
    )
    .bind(input.closedAt, input.closeReason, input.elapsedMs, input.submissionId, input.payloadHash, quizId, userId, unitPosition)
    .run()
  if (closeResult.meta.changes !== 1) return "lost_race"

  const statements = input.answers.map((answer) =>
    db
      .prepare(
        `INSERT INTO answers (quiz_id, user_id, question_id, position, unit_position, status, chosen_option, numeric_value, is_correct, marks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        quizId,
        userId,
        answer.questionId,
        answer.position,
        unitPosition,
        answer.status,
        answer.chosenOption,
        answer.numericValue,
        answer.isCorrect === null ? null : answer.isCorrect ? 1 : 0,
        answer.marks
      )
  )

  statements.push(
    db
      .prepare(
        `UPDATE participants
         SET total_score = total_score + ?,
             correct_count = correct_count + ?,
             wrong_count = wrong_count + ?,
             skipped_count = skipped_count + ?,
             unanswered_count = unanswered_count + ?,
             total_time_ms = total_time_ms + ?,
             current_unit_position = ?,
             finished_at = CASE WHEN ? THEN ? ELSE finished_at END
         WHERE quiz_id = ? AND user_id = ?`
      )
      .bind(
        input.aggregateDelta.scoreDelta,
        input.aggregateDelta.correctDelta,
        input.aggregateDelta.wrongDelta,
        input.aggregateDelta.skippedDelta,
        input.aggregateDelta.unansweredDelta,
        input.elapsedMs,
        input.next !== null ? input.next.unitPosition : unitPosition,
        input.finish ? 1 : 0,
        input.closedAt,
        quizId,
        userId
      )
  )

  if (input.next !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO participant_units (quiz_id, user_id, unit_position, started_at, deadline_at, submit_by_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(quizId, userId, input.next.unitPosition, input.next.startedAt, input.next.deadlineAt, input.next.submitByAt)
    )
  }

  await db.batch(statements)
  return "closed"
}

// Settles a reached-but-never-submitted unit as timed_out with no answer rows and every member
// counted unanswered — used only when `current`/a late submit discovers a silent server-only
// expiry, never as a substitute for an actual accepted batch.
export async function settleExpiredUnit(
  db: D1Database,
  params: {
    quizId: string
    userId: string
    unitPosition: number
    closedAt: number
    elapsedMs: number
    unansweredCount: number
    next: { unitPosition: number; startedAt: number; deadlineAt: number; submitByAt: number } | null
    finish: boolean
  }
): Promise<CloseUnitOutcome> {
  return closeUnitAtomic(db, {
    quizId: params.quizId,
    userId: params.userId,
    unitPosition: params.unitPosition,
    closedAt: params.closedAt,
    closeReason: "timed_out",
    elapsedMs: params.elapsedMs,
    submissionId: null,
    payloadHash: null,
    answers: [],
    aggregateDelta: {
      scoreDelta: 0,
      correctDelta: 0,
      wrongDelta: 0,
      skippedDelta: 0,
      unansweredDelta: params.unansweredCount,
    },
    next: params.next,
    finish: params.finish,
  })
}
