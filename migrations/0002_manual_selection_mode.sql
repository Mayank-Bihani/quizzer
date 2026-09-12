-- Sprint 10: manual question selection as an alternative to auto-draw quiz creation.
ALTER TABLE quizzes ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'auto' CHECK (selection_mode IN ('auto', 'manual'));
