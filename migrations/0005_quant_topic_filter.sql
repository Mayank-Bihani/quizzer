-- Lets an admin restrict a Quant auto-draw (one-off creation, reshuffle, and recurring templates
-- alike) to a specific set of topics. `topics` is a JSON-encoded string[], empty ([]) meaning "no
-- topic filter" — the same convention difficulty_mix already uses for "no constraint" on that
-- dimension. `questions.topic` carries no CHECK of its own (it's freeform), so topics doesn't
-- either. DEFAULT '[]' self-populates every existing row; no backfill UPDATE is needed.

ALTER TABLE quizzes ADD COLUMN topics TEXT NOT NULL DEFAULT '[]';
ALTER TABLE quiz_templates ADD COLUMN topics TEXT NOT NULL DEFAULT '[]';
