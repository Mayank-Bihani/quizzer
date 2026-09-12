import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FinishCard, HoldingCard } from "./DisclosureCards";

describe("result disclosure ladder", () => {
  it("shows only the student score and answered count at finish", () => {
    render(
      <FinishCard totalScore={38.5} answeredCount={17} questionCount={20} />,
    );

    expect(screen.getByText("38.5")).toBeInTheDocument();
    expect(screen.getByText(/17 of 20 answered/i)).toBeInTheDocument();
    expect(screen.queryByText(/rank|correct|student/i)).not.toBeInTheDocument();
  });

  it("adds anonymous finisher progress at holding and nothing competitive", () => {
    render(
      <HoldingCard
        totalScore={38.5}
        answeredCount={17}
        finishedCount={41}
        participantCount={83}
        estimatedUnlockAt={2_000}
        now={1_000}
      />,
    );

    expect(
      screen.getByText(/41 of 83 participants have finished/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/rank|correct|ananya/i)).not.toBeInTheDocument();
  });
});
