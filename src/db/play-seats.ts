// Idempotent seat preparation/room open and the race-safe seat claim + participant/unit-1 start
// — QUIZZING.md §5; migrations/0001_init.sql:212-249.

import { SEAT_PREP_CHUNK_SIZE } from "../core/config"

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

// INSERT OR IGNORE makes re-seeding after a crash a no-op for rows that already exist.
export async function seedSeats(db: D1Database, quizId: string, seatCap: number): Promise<void> {
  const seatNumbers = Array.from({ length: seatCap }, (_, i) => i + 1)
  for (const group of chunk(seatNumbers, SEAT_PREP_CHUNK_SIZE)) {
    await db.batch(
      group.map((seatNo) => db.prepare("INSERT OR IGNORE INTO quiz_seats (quiz_id, seat_no) VALUES (?, ?)").bind(quizId, seatNo))
    )
  }
}

export async function countSeats(db: D1Database, quizId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM quiz_seats WHERE quiz_id = ?").bind(quizId).first<{ n: number }>()
  return row?.n ?? 0
}

// Publishes 'open' only when the row is still a due 'scheduled' quiz — safe to call repeatedly;
// a losing/late caller simply sees changes===0 and must not treat that as failure.
export async function publishOpen(db: D1Database, quizId: string, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE quizzes SET status = 'open', opened_at = ?
       WHERE id = ? AND status = 'scheduled' AND lobby_opens_at <= ?`
    )
    .bind(now, quizId, now)
    .run()
  return result.meta.changes === 1
}

export type SeatClaimResult = { seatNo: number } | { full: true }

// Resume-safe: a user who already owns a seat gets it back without a second claim attempt.
// Concurrent claims for the same seat_no lose the conditional UPDATE and retry another seat;
// a concurrent claim by the SAME user hits the quiz_seats UNIQUE(quiz_id,user_id) index, which
// this function treats as "you already have a seat", not an error — migrations/0001_init.sql:218.
export async function claimSeatOrResume(db: D1Database, quizId: string, userId: string, now: number, seatCap: number): Promise<SeatClaimResult> {
  const existing = await db
    .prepare("SELECT seat_no FROM quiz_seats WHERE quiz_id = ? AND user_id = ?")
    .bind(quizId, userId)
    .first<{ seat_no: number }>()
  if (existing) return { seatNo: existing.seat_no }

  for (let attempt = 0; attempt < seatCap; attempt++) {
    const candidate = await db
      .prepare("SELECT seat_no FROM quiz_seats WHERE quiz_id = ? AND user_id IS NULL ORDER BY seat_no LIMIT 1")
      .bind(quizId)
      .first<{ seat_no: number }>()
    if (!candidate) return { full: true }

    try {
      const result = await db
        .prepare("UPDATE quiz_seats SET user_id = ?, claimed_at = ? WHERE quiz_id = ? AND seat_no = ? AND user_id IS NULL")
        .bind(userId, now, quizId, candidate.seat_no)
        .run()
      if (result.meta.changes === 1) return { seatNo: candidate.seat_no }
    } catch {
      const raced = await db
        .prepare("SELECT seat_no FROM quiz_seats WHERE quiz_id = ? AND user_id = ?")
        .bind(quizId, userId)
        .first<{ seat_no: number }>()
      if (raced) return { seatNo: raced.seat_no }
    }
    // else: another request claimed `candidate.seat_no` between the SELECT and the UPDATE — retry.
  }
  return { full: true }
}

// Idempotent: a concurrent duplicate call hits the participants PRIMARY KEY and is swallowed —
// the caller re-reads authoritative state afterward rather than trusting this call's outcome.
export async function startParticipant(
  db: D1Database,
  quizId: string,
  userId: string,
  seatNo: number,
  startedAt: number,
  unit1Position: number,
  unit1DeadlineAt: number,
  unit1SubmitByAt: number
): Promise<void> {
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO participants (quiz_id, user_id, seat_no, started_at, current_unit_position) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(quizId, userId, seatNo, startedAt, unit1Position),
      db
        .prepare(
          "INSERT INTO participant_units (quiz_id, user_id, unit_position, started_at, deadline_at, submit_by_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(quizId, userId, unit1Position, startedAt, unit1DeadlineAt, unit1SubmitByAt),
    ])
  } catch {
    // participants PK already exists — a concurrent/retried join already started this participant.
  }
}
