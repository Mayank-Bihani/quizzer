-- Sprint 12: LRDI/VARC auto-draw requests are expressed as whole-set counts, not raw graded-
-- question counts. An admin asking for "1" in an LR section meant "1 LRDI set", not "1 question
-- that happens to live inside a set" — the old flat `count`/`difficultyMix` shape couldn't express
-- that, so a count of 1 either failed outright for lr (no 1-question lrdi group exists) or silently
-- grabbed a lone standalone VA question for verbal instead of a full RC passage.
--
-- `set_count` is the number of whole rc/lrdi units requested (all of lr; the RC portion of verbal).
-- `standalone_count` is the number of standalone graded questions requested (all of quant; the VA
-- portion of verbal). `difficulty_mix` now scopes standalone_count only — a set's members keep
-- whatever difficulties they were authored with; a set is never targeted by difficulty (BANK.md:
-- passages carry no difficulty of their own).
--
-- quizzes.question_count/unit_count keep their existing meaning — the ACTUAL resulting totals
-- after a draw, always populated regardless of type — unaffected by this change. quiz_templates
-- never has a draw result yet, so its question_count was always the REQUEST target; quant's request
-- moves into standalone_count alongside every other type (one uniform {setCount, standaloneCount,
-- difficultyMix} shape everywhere — src/core/selection.ts's toStoredDrawRequest), so question_count
-- has no remaining purpose and is dropped via ALTER TABLE ... DROP COLUMN (supported directly,
-- unlike a NOT NULL/CHECK relaxation) rather than the drop/recreate procedure 0003_monthly_boards
-- .sql used: quiz_templates is the target of a live FK from quizzes.template_id, and D1 enforces
-- foreign keys unconditionally (PRAGMA foreign_keys=OFF is not honored), so dropping and recreating
-- this particular table would fail against any database that already has scheduled/materialized
-- quizzes pointing at a template.

ALTER TABLE quizzes ADD COLUMN set_count INTEGER CHECK (set_count IS NULL OR (set_count >= 0 AND set_count <= 100));
ALTER TABLE quizzes ADD COLUMN standalone_count INTEGER CHECK (standalone_count IS NULL OR (standalone_count >= 0 AND standalone_count <= 100));

ALTER TABLE quiz_templates ADD COLUMN set_count INTEGER CHECK (set_count IS NULL OR (set_count >= 0 AND set_count <= 100));
ALTER TABLE quiz_templates ADD COLUMN standalone_count INTEGER CHECK (standalone_count IS NULL OR (standalone_count >= 0 AND standalone_count <= 100));

-- quant's old `question_count` was always an exact standalone target, so it carries over exactly
-- into standalone_count with no behavior change. Existing lr/verbal templates predate the
-- set/standalone distinction: their stored question_count was always a raw question count, never a
-- set count, so it cannot be reinterpreted automatically. Carry it into set_count as the closest
-- available number (and default standalone_count to 0 for verbal) purely so the row still passes
-- validation — an admin must review and re-enter the real intended set/standalone counts, since the
-- resulting draw size will otherwise likely change materially the next time the template fires.
UPDATE quiz_templates SET standalone_count = question_count WHERE type = 'quant';
UPDATE quiz_templates SET set_count = question_count, standalone_count = 0 WHERE type != 'quant';

ALTER TABLE quiz_templates DROP COLUMN question_count;
