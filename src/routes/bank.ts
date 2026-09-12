// The seven admin BANK routes: import preview/commit, question browse/detail/PATCH/DELETE, and
// passage list — BANK.md §5. GET /api/images/:key lives in routes/images.ts (different guard).

import { Hono } from "hono"
import type { Bindings, Variables } from "../core/config"
import { DEFAULT_PAGE_LIMIT, MAX_CSV_BYTES, MAX_PAGE_LIMIT } from "../core/config"
import type { Difficulty, QuizType } from "../core/contracts"
import type {
  DeleteQuestionResponse,
  GetQuestionResponse,
  ImportCommitResponse,
  ImportCounts,
  ImportPreviewResponse,
  ImportRowError,
  ListPassagesResponse,
  ListQuestionsResponse,
  PassageGroupSummary,
  UpdateQuestionRequest,
  UpdateQuestionResponse,
} from "../core/api"
import {
  parseBankCsv,
  validateImageReferences,
  type NormalizedPassage,
  type NormalizedQuestion,
  type ZipInventoryEntry,
} from "../core/csv"
import {
  deleteImage,
  deleteImagesByPrefix,
  extractImagesFromZip,
  generateImageKey,
  imageKeyPrefix,
  uploadImage,
  type ExtractedImage,
} from "../services/images"
import {
  commitImport,
  deleteQuestionCascade,
  getQuestionById,
  listPassages,
  listQuestionsPage,
  updateQuestion,
  type ImportCandidate,
} from "../db/bank"
import { currentUser, requireRole } from "../middleware/auth"

const bank = new Hono<{ Bindings: Bindings; Variables: Variables }>()
bank.use("*", requireRole("admin"))

const GENERIC_UPLOAD_ERROR = { message: "Invalid upload" }
const ZERO_COUNTS: ImportCounts = {
  questions: 0,
  passages: 0,
  byType: { verbal: 0, quant: 0, lr: 0 },
  byFormat: { mcq: 0, tita: 0 },
}

function countsFrom(passages: NormalizedPassage[], questions: NormalizedQuestion[]): ImportCounts {
  const byType: ImportCounts["byType"] = { verbal: 0, quant: 0, lr: 0 }
  const byFormat: ImportCounts["byFormat"] = { mcq: 0, tita: 0 }
  for (const question of questions) {
    byType[question.type]++
    byFormat[question.format]++
  }
  return { questions: questions.length, passages: passages.length, byType, byFormat }
}

function groupSummariesFrom(passages: NormalizedPassage[], questions: NormalizedQuestion[]): PassageGroupSummary[] {
  const sizeByRef = new Map<string, number>()
  for (const question of questions) {
    if (!question.passageRef) continue
    sizeByRef.set(question.passageRef, (sizeByRef.get(question.passageRef) ?? 0) + 1)
  }
  return passages
    .filter((p) => sizeByRef.has(p.passageRef))
    .map((p) => ({ passageId: p.passageRef, size: sizeByRef.get(p.passageRef) ?? 0 }))
}

type UploadValidation =
  | { kind: "structural_error" }
  | {
      kind: "validated"
      errors: ImportRowError[]
      passages: NormalizedPassage[]
      questions: NormalizedQuestion[]
      acceptedImages: ExtractedImage[]
    }

async function validateUpload(req: Request): Promise<UploadValidation> {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return { kind: "structural_error" }
  }
  const allowedFields = new Set(["csv", "images"])
  const presentFields = [...form.keys()]
  if (presentFields.some((f) => !allowedFields.has(f)) || !form.has("csv")) {
    return { kind: "structural_error" }
  }

  const csvFile = form.get("csv")
  if (!(csvFile instanceof File)) return { kind: "structural_error" }
  const imagesFile = form.get("images")
  if (imagesFile !== null && !(imagesFile instanceof File)) return { kind: "structural_error" }

  const errors: ImportRowError[] = []

  let parsedPassages: NormalizedPassage[] = []
  let parsedQuestions: NormalizedQuestion[] = []
  let imageReferences: { filename: string; line: number }[] = []
  if (csvFile.size > MAX_CSV_BYTES) {
    errors.push({ line: 0, message: `CSV exceeds the maximum allowed size of ${MAX_CSV_BYTES} bytes` })
  } else {
    const csvText = new TextDecoder("utf-8").decode(await csvFile.arrayBuffer())
    const parsed = parseBankCsv(csvText)
    errors.push(...parsed.errors)
    parsedPassages = parsed.passages
    parsedQuestions = parsed.questions
    imageReferences = parsed.imageReferences
  }

  let zipInventory: ZipInventoryEntry[] | null = null
  let acceptedImages: ExtractedImage[] = []
  if (imagesFile instanceof File) {
    const zipBytes = new Uint8Array(await imagesFile.arrayBuffer())
    const extraction = extractImagesFromZip(zipBytes)
    if (extraction.malformed) {
      errors.push({ line: 0, message: "Companion ZIP is malformed or exceeds the maximum upload size" })
      zipInventory = []
    } else {
      zipInventory = [
        ...extraction.images.map((img) => ({ name: img.filename, accepted: true })),
        ...extraction.rejected.map((r) => ({ name: r.name, accepted: false as const, reason: r.reason })),
      ]
      acceptedImages = extraction.images
    }
  }

  errors.push(...validateImageReferences(imageReferences, zipInventory))
  errors.sort((a, b) => a.line - b.line)

  return { kind: "validated", errors, passages: parsedPassages, questions: parsedQuestions, acceptedImages }
}

bank.post("/import/preview", async (c) => {
  const validation = await validateUpload(c.req.raw)
  if (validation.kind === "structural_error") return c.json(GENERIC_UPLOAD_ERROR, 400)

  const body: ImportPreviewResponse = {
    counts: countsFrom(validation.passages, validation.questions),
    passageGroups: groupSummariesFrom(validation.passages, validation.questions),
    errors: validation.errors,
  }
  return c.json(body, 200)
})

function toPassageInsert(passage: NormalizedPassage, filenameToKey: Map<string, string>): ImportCandidate["passages"][number] {
  return {
    passageRef: passage.passageRef,
    type: passage.type,
    topic: passage.topic,
    bodyMd: passage.bodyMd,
    imageKey: passage.imageFilename ? (filenameToKey.get(passage.imageFilename) ?? null) : null,
    source: passage.source,
  }
}

function toQuestionInsert(question: NormalizedQuestion, filenameToKey: Map<string, string>): ImportCandidate["questions"][number] {
  return {
    type: question.type,
    topic: question.topic,
    subtopic: question.subtopic,
    difficulty: question.difficulty,
    format: question.format,
    passageRef: question.passageRef,
    groupPosition: question.groupPosition,
    bodyMd: question.bodyMd,
    imageKey: question.imageFilename ? (filenameToKey.get(question.imageFilename) ?? null) : null,
    optionA: question.optionA,
    optionB: question.optionB,
    optionC: question.optionC,
    optionD: question.optionD,
    correctOption: question.correctOption,
    numericAnswer: question.numericAnswer,
    numericTolerance: question.numericTolerance,
    explanationMd: question.explanationMd,
    source: question.source,
  }
}

async function cleanupImportImages(bucket: R2Bucket, importId: string): Promise<void> {
  try {
    await deleteImagesByPrefix(bucket, imageKeyPrefix(importId))
  } catch (cause) {
    console.error("BANK R2 cleanup failed", { importId, prefix: imageKeyPrefix(importId), cause: String(cause) })
  }
}

bank.post("/import/commit", async (c) => {
  const validation = await validateUpload(c.req.raw)
  if (validation.kind === "structural_error") return c.json(GENERIC_UPLOAD_ERROR, 400)

  if (validation.errors.length > 0) {
    const body: ImportCommitResponse = { importId: null, counts: ZERO_COUNTS, errors: validation.errors }
    return c.json(body, 200)
  }

  const importId = crypto.randomUUID()
  const filenameToKey = new Map<string, string>()
  try {
    for (const image of validation.acceptedImages) {
      const key = generateImageKey(importId)
      await uploadImage(c.env.IMAGES, key, image.bytes, image.contentType)
      filenameToKey.set(image.filename, key)
    }
  } catch (cause) {
    console.error("BANK image upload failed", { importId, cause: String(cause) })
    await cleanupImportImages(c.env.IMAGES, importId)
    return c.json({ message: "Import failed" }, 500)
  }

  const candidate: ImportCandidate = {
    passages: validation.passages.map((p) => toPassageInsert(p, filenameToKey)),
    questions: validation.questions.map((q) => toQuestionInsert(q, filenameToKey)),
  }

  try {
    const result = await commitImport(c.env.DB, importId, candidate, currentUser(c).id, () => Date.now())
    const body: ImportCommitResponse = { importId: result.importId, counts: result.counts, errors: [] }
    return c.json(body, 200)
  } catch (cause) {
    console.error("BANK import commit failed", { importId, cause: String(cause) })
    await cleanupImportImages(c.env.IMAGES, importId)
    return c.json({ message: "Import failed" }, 500)
  }
})

function parsePaginationParam(raw: string | undefined, fallback: number): number | "invalid" {
  if (raw === undefined) return fallback
  if (!/^-?\d+$/.test(raw)) return "invalid"
  return Number(raw)
}

const VALID_TYPES: readonly QuizType[] = ["verbal", "quant", "lr"]
const VALID_DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"]

bank.get("/questions", async (c) => {
  const limitRaw = parsePaginationParam(c.req.query("limit"), DEFAULT_PAGE_LIMIT)
  const offsetRaw = parsePaginationParam(c.req.query("offset"), 0)
  if (limitRaw === "invalid" || offsetRaw === "invalid" || limitRaw < 1 || limitRaw > MAX_PAGE_LIMIT || offsetRaw < 0) {
    return c.json({ message: "Invalid pagination parameters" }, 400)
  }

  const type = c.req.query("type")
  const topic = c.req.query("topic")
  const difficulty = c.req.query("difficulty")
  const used = c.req.query("used")
  const passageId = c.req.query("passageId")
  if (type !== undefined && !VALID_TYPES.includes(type as QuizType)) {
    return c.json({ message: "Invalid type filter" }, 400)
  }
  if (difficulty !== undefined && !VALID_DIFFICULTIES.includes(difficulty as Difficulty)) {
    return c.json({ message: "Invalid difficulty filter" }, 400)
  }
  if (used !== undefined && used !== "true" && used !== "false") {
    return c.json({ message: "Invalid used filter" }, 400)
  }

  const { items, total } = await listQuestionsPage(
    c.env.DB,
    {
      type: type as QuizType | undefined,
      topic,
      difficulty: difficulty as Difficulty | undefined,
      used: used === undefined ? undefined : used === "true",
      passageId,
    },
    limitRaw,
    offsetRaw
  )
  const body: ListQuestionsResponse = { items, total, limit: limitRaw, offset: offsetRaw }
  return c.json(body, 200)
})

bank.get("/questions/:id", async (c) => {
  const question = await getQuestionById(c.env.DB, c.req.param("id"))
  if (!question) return c.json({ message: "Question not found" }, 404)
  const body: GetQuestionResponse = question
  return c.json(body, 200)
})

const PATCHABLE_FIELDS = [
  "topic",
  "subtopic",
  "difficulty",
  "bodyMd",
  "optionA",
  "optionB",
  "optionC",
  "optionD",
  "numericTolerance",
  "explanationMd",
  "source",
] as const

bank.patch("/questions/:id", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ message: "Invalid request body" }, 400)
  }
  if (typeof body !== "object" || body === null) return c.json({ message: "Invalid request body" }, 400)
  const keys = Object.keys(body as Record<string, unknown>)
  if (keys.some((k) => !(PATCHABLE_FIELDS as readonly string[]).includes(k))) {
    return c.json({ message: "Unknown or forbidden field in request body" }, 400)
  }

  const patch = body as UpdateQuestionRequest
  const outcome = await updateQuestion(c.env.DB, c.req.param("id"), patch)
  if (!outcome.ok) {
    if (outcome.reason === "not_found") return c.json({ message: "Question not found" }, 404)
    return c.json({ message: "Field cannot be edited on this question" }, 400)
  }
  const responseBody: UpdateQuestionResponse = outcome.question
  return c.json(responseBody, 200)
})

bank.delete("/questions/:id", async (c) => {
  const outcome = await deleteQuestionCascade(c.env.DB, c.req.param("id"))
  if (!outcome.ok) {
    if (outcome.reason === "not_found") return c.json({ message: "Question not found" }, 404)
    return c.json({ message: "Question is already used and cannot be deleted" }, 409)
  }
  for (const key of outcome.deletedImageKeys) {
    try {
      await deleteImage(c.env.IMAGES, key)
    } catch (cause) {
      console.error("BANK image delete failed", { key, cause: String(cause) })
    }
  }
  const body: DeleteQuestionResponse = { success: true }
  return c.json(body, 200)
})

bank.get("/passages", async (c) => {
  const passages = await listPassages(c.env.DB)
  const body: ListPassagesResponse = { passages }
  return c.json(body, 200)
})

export default bank
