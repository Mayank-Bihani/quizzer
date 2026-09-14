// BANK facade — passages, questions, BankContract, and admin CRUD, split across adjacent
// BANK-owned persistence files for size; this is the one import surface for the rest of the app.

export {
  commitImport,
  deleteImportRows,
  ImportCleanupFailedError,
  type ImportCandidate,
  type PassageInsert,
  type QuestionInsert,
} from "./bank-import"

export {
  listQuestionsPage,
  getQuestionById,
  listPassages,
  listDistinctTopics,
  updateQuestion,
  deleteQuestionCascade,
  type QuestionFilters,
  type UpdateOutcome,
  type DeleteOutcome,
} from "./bank-crud"

export { listUnused, claimUnused, getByIds, createBankContract } from "./bank-contract"
