import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MonthlyBoardResponse,
  WeeklyBoardResponse,
} from "../../../../src/core/api";
import { WeeklyBoardPage } from "./StudentPages";

const { weeklyBoard, monthlyBoard } = vi.hoisted(() => ({
  weeklyBoard: vi.fn(),
  monthlyBoard: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: { weeklyBoard, monthlyBoard },
}));

const WEEKLY_RESPONSE: WeeklyBoardResponse = {
  items: [
    { rank: 1, userId: "u1", name: "Alice", totalScore: 40, quizzesTaken: 3 },
  ],
  total: 1,
  limit: 50,
  offset: 0,
  weekStart: "2026-09-07",
  type: "overall",
};

const MONTHLY_RESPONSE: MonthlyBoardResponse = {
  items: [
    { rank: 1, userId: "u2", name: "Bob", totalScore: 120, quizzesTaken: 8 },
  ],
  total: 1,
  limit: 50,
  offset: 0,
  monthStart: "2026-09-01",
  type: "overall",
};

function renderPage(initialEntries: string[] = ["/boards/weekly"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <WeeklyBoardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  weeklyBoard.mockReset();
  monthlyBoard.mockReset();
  weeklyBoard.mockResolvedValue(WEEKLY_RESPONSE);
  monthlyBoard.mockResolvedValue(MONTHLY_RESPONSE);
});

describe("WeeklyBoardPage — period toggle (Sprint 11)", () => {
  it("FE-1: defaults to the weekly period, calling weeklyBoard and never monthlyBoard", async () => {
    renderPage();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(weeklyBoard).toHaveBeenCalledTimes(1);
    expect(monthlyBoard).not.toHaveBeenCalled();
    const weeklyTab = screen.getByRole("tab", { name: "Weekly" });
    expect(weeklyTab).toHaveAttribute("aria-selected", "true");
  });

  it("FE-2: switching to Monthly calls monthlyBoard instead of weeklyBoard and swaps the date input to type=month", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Alice");

    await user.click(screen.getByRole("tab", { name: "Monthly" }));

    expect(await screen.findByText("Bob")).toBeInTheDocument();
    await waitFor(() => expect(monthlyBoard).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/published month starting/i)).toHaveAttribute(
      "type",
      "month",
    );
  });

  it("FE-3: the type tabs still apply under the monthly period", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Alice");
    await user.click(screen.getByRole("tab", { name: "Monthly" }));
    await screen.findByText("Bob");

    await user.click(screen.getByRole("tab", { name: "Verbal" }));

    await waitFor(() =>
      expect(monthlyBoard).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "verbal" }),
      ),
    );
  });

  it("FE-4: renders the empty state for a monthly board with no published entries, without crashing", async () => {
    const user = userEvent.setup();
    monthlyBoard.mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      monthStart: "",
      type: "overall",
    } satisfies MonthlyBoardResponse);
    renderPage();
    await screen.findByText("Alice");

    await user.click(screen.getByRole("tab", { name: "Monthly" }));

    expect(await screen.findByText(/no published entries/i)).toBeInTheDocument();
  });

  it("FE-5: pagination works identically to the weekly path when a monthly board has more rows than the page limit", async () => {
    const user = userEvent.setup();
    monthlyBoard.mockResolvedValue({
      items: [
        { rank: 1, userId: "u2", name: "Bob", totalScore: 120, quizzesTaken: 8 },
      ],
      total: 75,
      limit: 50,
      offset: 0,
      monthStart: "2026-09-01",
      type: "overall",
    } satisfies MonthlyBoardResponse);
    renderPage();
    await screen.findByText("Alice");

    await user.click(screen.getByRole("tab", { name: "Monthly" }));
    await screen.findByText("Bob");

    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeEnabled();
    await user.click(nextButton);

    await waitFor(() =>
      expect(monthlyBoard).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 50 }),
      ),
    );
  });

  it("FE-6: switching from weekly to monthly does not leak the weekStart value into monthStart", async () => {
    const user = userEvent.setup();
    renderPage(["/boards/weekly?weekStart=2026-09-07"]);
    await screen.findByText("Alice");

    await user.click(screen.getByRole("tab", { name: "Monthly" }));
    await screen.findByText("Bob");

    await waitFor(() =>
      expect(monthlyBoard).toHaveBeenCalledWith(
        expect.not.objectContaining({ monthStart: "2026-09-07" }),
      ),
    );
  });

  it("never changes the default view when no period param is present — weekly renders exactly as before", async () => {
    renderPage(["/boards/weekly"]);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByLabelText(/published week starting/i)).toHaveAttribute(
      "type",
      "date",
    );
  });
});
