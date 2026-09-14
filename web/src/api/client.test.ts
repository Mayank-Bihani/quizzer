import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, createApiClient } from "./client";

describe("API client", () => {
  it("sends exact JSON bodies with same-origin credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createApiClient(fetcher);

    await client.setUserRole("user-1", { role: "admin" });

    expect(fetcher).toHaveBeenCalledWith("/api/admin/users/user-1/role", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
  });

  it("does not add a content type to bodyless requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ quizzes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createApiClient(fetcher);

    await client.openQuizzes();

    expect(fetcher).toHaveBeenCalledWith("/api/quizzes/open", {
      method: "GET",
      credentials: "same-origin",
    });
  });

  it("preserves backend status and safe error message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "The room is full." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(createApiClient(fetcher).joinQuiz("QNT-1234")).rejects.toEqual(
      new ApiRequestError(409, "The room is full."),
    );
  });

  it("announces an expired session after a protected request returns 401", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Session expired." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const expired = vi.fn();
    window.addEventListener("quizzer:unauthorized", expired, { once: true });

    await expect(createApiClient(fetcher).history()).rejects.toBeInstanceOf(
      ApiRequestError,
    );

    expect(expired).toHaveBeenCalledOnce();
  });

  it("encodes list filters without inventing defaults", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const client = createApiClient(fetcher);

    await client.questions({ type: "quant", used: false, limit: 25 });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/bank/questions?limit=25&type=quant&used=false",
      {
        method: "GET",
        credentials: "same-origin",
      },
    );
  });

  it("requests distinct topics for a given quiz type", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ topics: ["Arithmetic"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createApiClient(fetcher);

    await client.topics("quant");

    expect(fetcher).toHaveBeenCalledWith("/api/bank/topics?type=quant", {
      method: "GET",
      credentials: "same-origin",
    });
  });
});
