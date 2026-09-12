import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";

const { me } = vi.hoisted(() => ({ me: vi.fn() }));

vi.mock("../api/client", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: {
    me,
    signIn: vi.fn(),
    logout: vi.fn(),
  },
}));

function StateProbe() {
  const { sessionExpired, user } = useAuth();
  return (
    <p>{user?.name ?? (sessionExpired ? "Session expired" : "Signed out")}</p>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    me.mockResolvedValue({
      id: "u1",
      name: "Priya",
      role: "student",
      pictureUrl: null,
    });
  });

  it("marks an established session as expired when a protected request returns 401", async () => {
    render(
      <AuthProvider>
        <StateProbe />
      </AuthProvider>,
    );
    await screen.findByText("Priya");

    window.dispatchEvent(new Event("quizzer:unauthorized"));

    await waitFor(() =>
      expect(screen.getByText("Session expired")).toBeInTheDocument(),
    );
  });
});
