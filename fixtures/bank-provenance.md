# `fixtures/bank.csv` provenance

Derived from the checked CAT 2018 Slot 1 archive in `fixtures/bank/cat-2018/` (see that
directory's own `README.md`/`SHA256SUMS`, which this fixture does not modify). Every answer below
was verified against `fixtures/bank/cat-2018/answer-key.csv`.

| Fixture group/row | Source | Answer key rows |
|---|---|---|
| `rc-elephants-2018` passage + 5 questions | `slot-1-varc.txt`, Q1–5 (the elephants/Bradshaw passage) | `1,VARC,1..5` |
| `lr-written-test-2018` passage + 4 questions | `slot-1-dilr.txt` / `source-pdfs/slot-1-dilr.pdf` page 2, "SET 1: Written Test" | `1,DILR,1..4` |
| Standalone MCQ (paint mixture) | `slot-1-qa.txt`, Q1 | `1,QA,1` |
| Standalone TITA (`f(x)` recurrence) | `slot-1-qa.txt`, Q3 | `1,QA,3` |
| Standalone MCQ (summary) | `slot-1-varc.txt`, Q28 | `1,VARC,28` |

`fixtures/bank-images.zip` contains `written-test-marks.png`, a crop of the marks table from
`source-pdfs/slot-1-dilr.pdf` page 2 (the LRDI set's own image — the source PDF renders these
marks as a graphic, not extractable text, which is exactly why the set needs an image reference).

Explanations are paraphrased/condensed from the source solutions, not reproduced verbatim.
`difficulty` values are authored for this fixture (the source archive carries no difficulty
rating); `topic`/`subtopic` follow the `###TOPIC###` breadcrumbs present in the QA source text
where available, or a reasonable label otherwise. One row (`Functions and Graphs` TITA) leaves
`subtopic` and `source` blank to exercise BANK's optional-column handling.
