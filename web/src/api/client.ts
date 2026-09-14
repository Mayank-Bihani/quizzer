import type {
  AdminListUsersResponse,
  AdminReportRequest,
  AdminReportResponse,
  CancelQuizResponse,
  CreateQuizDraftRequest,
  CreateQuizDraftResponse,
  CreateTemplateRequest,
  CreateTemplateResponse,
  CurrentUnitResponse,
  DeactivateTemplateResponse,
  DeleteQuestionResponse,
  GetMeResponse,
  GetQuestionResponse,
  GoogleSignInRequest,
  GoogleSignInResponse,
  HistoryRequest,
  HistoryResponse,
  ImportCommitResponse,
  ImportPreviewResponse,
  JoinQuizResponse,
  LeaderboardResponse,
  ListPassagesResponse,
  ListQuestionsRequest,
  ListQuestionsResponse,
  ListQuizzesRequest,
  ListQuizzesResponse,
  ListTemplatesRequest,
  ListTemplatesResponse,
  ListTopicsResponse,
  LockQuizResponse,
  LogoutResponse,
  MaterializeTemplatesNowResponse,
  MonthlyBoardRequest,
  MonthlyBoardResponse,
  PlayStatusResponse,
  ReshuffleQuizResponse,
  ReviewResponse,
  SetUserRoleRequest,
  SetUserRoleResponse,
  SubmitUnitRequest,
  SubmitUnitResponse,
  UpdateQuestionRequest,
  UpdateQuestionResponse,
  UpdateQuizParamsRequest,
  UpdateQuizParamsResponse,
  UpdateTemplateRequest,
  UpdateTemplateResponse,
  WeeklyBoardRequest,
  WeeklyBoardResponse,
  ListOpenQuizzesResponse,
  ListUpcomingQuizzesResponse,
} from "../../../src/core/api";
import type { QuizType } from "../../../src/core/contracts";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type QueryValue = string | number | boolean | undefined;

function withQuery(path: string, request: Record<string, QueryValue>): string {
  const query = new URLSearchParams();
  Object.entries(request)
    .filter(
      (entry): entry is [string, Exclude<QueryValue, undefined>] =>
        entry[1] !== undefined,
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => query.set(key, String(value)));
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

async function parseError(response: Response): Promise<ApiRequestError> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string")
      return new ApiRequestError(response.status, body.message);
  } catch {
    // The generic message below avoids leaking an unexpected upstream response body.
  }
  return new ApiRequestError(
    response.status,
    "Something went wrong. Please try again.",
  );
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export function createApiClient(fetcher: typeof fetch = fetch) {
  async function request<ResponseBody>(
    path: string,
    init: RequestInit,
  ): Promise<ResponseBody> {
    const response = await fetcher(path, {
      ...init,
      credentials: "same-origin",
    });
    if (!response.ok) {
      if (response.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("quizzer:unauthorized"));
      }
      throw await parseError(response);
    }
    return (await response.json()) as ResponseBody;
  }

  function get<ResponseBody>(path: string): Promise<ResponseBody> {
    return request<ResponseBody>(path, { method: "GET" });
  }

  function send<RequestBody, ResponseBody>(
    path: string,
    method: "POST" | "PATCH",
    body: RequestBody,
  ): Promise<ResponseBody> {
    return request<ResponseBody>(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function post<ResponseBody>(path: string): Promise<ResponseBody> {
    return request<ResponseBody>(path, { method: "POST" });
  }

  function upload<ResponseBody>(
    path: string,
    form: FormData,
  ): Promise<ResponseBody> {
    return request<ResponseBody>(path, { method: "POST", body: form });
  }

  return {
    signIn: (body: GoogleSignInRequest) =>
      send<GoogleSignInRequest, GoogleSignInResponse>(
        "/api/auth/google",
        "POST",
        body,
      ),
    logout: () => post<LogoutResponse>("/api/auth/logout"),
    me: () => get<GetMeResponse>("/api/auth/me"),
    users: () => get<AdminListUsersResponse>("/api/admin/users"),
    setUserRole: (id: string, body: SetUserRoleRequest) =>
      send<SetUserRoleRequest, SetUserRoleResponse>(
        `/api/admin/users/${encodeSegment(id)}/role`,
        "POST",
        body,
      ),
    importPreview: (form: FormData) =>
      upload<ImportPreviewResponse>("/api/bank/import/preview", form),
    importCommit: (form: FormData) =>
      upload<ImportCommitResponse>("/api/bank/import/commit", form),
    questions: (query: ListQuestionsRequest = {}) =>
      get<ListQuestionsResponse>(withQuery("/api/bank/questions", query)),
    topics: (type: QuizType) =>
      get<ListTopicsResponse>(withQuery("/api/bank/topics", { type })),
    question: (id: string) =>
      get<GetQuestionResponse>(`/api/bank/questions/${encodeSegment(id)}`),
    updateQuestion: (id: string, body: UpdateQuestionRequest) =>
      send<UpdateQuestionRequest, UpdateQuestionResponse>(
        `/api/bank/questions/${encodeSegment(id)}`,
        "PATCH",
        body,
      ),
    deleteQuestion: (id: string) =>
      request<DeleteQuestionResponse>(
        `/api/bank/questions/${encodeSegment(id)}`,
        {
          method: "DELETE",
        },
      ),
    passages: () => get<ListPassagesResponse>("/api/bank/passages"),
    quizzes: (query: ListQuizzesRequest = {}) =>
      get<ListQuizzesResponse>(withQuery("/api/admin/quizzes", query)),
    createQuiz: (body: CreateQuizDraftRequest) =>
      send<CreateQuizDraftRequest, CreateQuizDraftResponse>(
        "/api/admin/quizzes",
        "POST",
        body,
      ),
    reshuffleQuiz: (id: string) =>
      post<ReshuffleQuizResponse>(
        `/api/admin/quizzes/${encodeSegment(id)}/reshuffle`,
      ),
    updateQuiz: (id: string, body: UpdateQuizParamsRequest) =>
      send<UpdateQuizParamsRequest, UpdateQuizParamsResponse>(
        `/api/admin/quizzes/${encodeSegment(id)}`,
        "PATCH",
        body,
      ),
    lockQuiz: (id: string) =>
      post<LockQuizResponse>(`/api/admin/quizzes/${encodeSegment(id)}/lock`),
    cancelQuiz: (id: string) =>
      post<CancelQuizResponse>(
        `/api/admin/quizzes/${encodeSegment(id)}/cancel`,
      ),
    templates: (query: ListTemplatesRequest = {}) =>
      get<ListTemplatesResponse>(withQuery("/api/admin/templates", query)),
    createTemplate: (body: CreateTemplateRequest) =>
      send<CreateTemplateRequest, CreateTemplateResponse>(
        "/api/admin/templates",
        "POST",
        body,
      ),
    updateTemplate: (id: string, body: UpdateTemplateRequest) =>
      send<UpdateTemplateRequest, UpdateTemplateResponse>(
        `/api/admin/templates/${encodeSegment(id)}`,
        "PATCH",
        body,
      ),
    deactivateTemplate: (id: string) =>
      post<DeactivateTemplateResponse>(
        `/api/admin/templates/${encodeSegment(id)}/deactivate`,
      ),
    materializeTemplatesNow: () =>
      post<MaterializeTemplatesNowResponse>(
        "/api/admin/templates/materialize-now",
      ),
    openQuizzes: () => get<ListOpenQuizzesResponse>("/api/quizzes/open"),
    upcomingQuizzes: () =>
      get<ListUpcomingQuizzesResponse>("/api/quizzes/upcoming"),
    joinQuiz: (code: string) =>
      post<JoinQuizResponse>(`/api/quizzes/${encodeSegment(code)}/join`),
    currentUnit: (quizId: string) =>
      get<CurrentUnitResponse>(`/api/play/${encodeSegment(quizId)}/current`),
    submitUnit: (
      quizId: string,
      unitPosition: number,
      body: SubmitUnitRequest,
    ) =>
      send<SubmitUnitRequest, SubmitUnitResponse>(
        `/api/play/${encodeSegment(quizId)}/units/${unitPosition}/submit`,
        "POST",
        body,
      ),
    playStatus: (quizId: string) =>
      get<PlayStatusResponse>(`/api/play/${encodeSegment(quizId)}/status`),
    leaderboard: (quizId: string) =>
      get<LeaderboardResponse>(
        `/api/quizzes/${encodeSegment(quizId)}/leaderboard`,
      ),
    review: (quizId: string) =>
      get<ReviewResponse>(`/api/quizzes/${encodeSegment(quizId)}/review`),
    history: (query: HistoryRequest = {}) =>
      get<HistoryResponse>(withQuery("/api/students/me/history", query)),
    weeklyBoard: (query: WeeklyBoardRequest = {}) =>
      get<WeeklyBoardResponse>(withQuery("/api/boards/weekly", query)),
    monthlyBoard: (query: MonthlyBoardRequest = {}) =>
      get<MonthlyBoardResponse>(withQuery("/api/boards/monthly", query)),
    adminReport: (id: string, query: AdminReportRequest = {}) =>
      get<AdminReportResponse>(
        withQuery(`/api/admin/quizzes/${encodeSegment(id)}/report`, query),
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export const api = createApiClient();
