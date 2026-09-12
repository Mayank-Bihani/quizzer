import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateSummary } from "../../../../src/core/api";
import { TemplatesPanel } from "./TemplatesPanel";

const { templates, createTemplate, updateTemplate, deactivateTemplate } =
  vi.hoisted(() => ({
    templates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deactivateTemplate: vi.fn(),
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
  api: { templates, createTemplate, updateTemplate, deactivateTemplate },
}));

const QUANT_TEMPLATE: TemplateSummary = {
  id: "t1",
  name: "Weekly Quant",
  type: "quant",
  questionCount: 2,
  difficultyMix: { easy: 2 },
  timingPolicy: { standalone: 60, lrdi: 180 },
  slackSec: 30,
  joinWindowSec: 600,
  marksCorrect: 4,
  marksWrong: -1,
  seatCap: 120,
  rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
  active: true,
};

beforeEach(() => {
  templates.mockReset();
  createTemplate.mockReset();
  updateTemplate.mockReset();
  deactivateTemplate.mockReset();
  templates.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
});

describe("TemplatesPanel", () => {
  it("shows an empty state when there are no templates", async () => {
    render(<TemplatesPanel />);
    expect(
      await screen.findByText(/no recurring templates yet/i),
    ).toBeInTheDocument();
  });

  it("lists a template's name, schedule, and active badge", async () => {
    templates.mockResolvedValue({
      items: [QUANT_TEMPLATE],
      total: 1,
      limit: 20,
      offset: 0,
    });
    render(<TemplatesPanel />);

    expect(await screen.findByText("Weekly Quant")).toBeInTheDocument();
    expect(screen.getByText(/tue/i)).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("creates a template from the form and reloads the list", async () => {
    const user = userEvent.setup();
    createTemplate.mockResolvedValue({ ...QUANT_TEMPLATE, id: "new" });
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));

    await user.type(screen.getByLabelText(/name/i), "Weekly Quant");
    await user.selectOptions(screen.getByLabelText(/^section$/i), "quant");
    await user.type(screen.getByLabelText(/question count/i), "2");
    await user.type(screen.getByLabelText(/^easy/i), "2");
    await user.type(screen.getByLabelText(/^medium/i), "0");
    await user.type(screen.getByLabelText(/^hard/i), "0");
    await user.type(screen.getByLabelText(/standalone unit seconds/i), "60");
    await user.type(screen.getByLabelText(/lrdi unit seconds/i), "180");
    await user.type(screen.getByLabelText(/buffer time between units/i), "30");
    await user.type(screen.getByLabelText(/admission window seconds/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(1));
    expect(createTemplate).toHaveBeenCalledWith({
      name: "Weekly Quant",
      type: "quant",
      questionCount: 2,
      difficultyMix: { easy: 2, medium: 0, hard: 0 },
      timingPolicy: { standalone: 60, lrdi: 180 },
      slackSec: 30,
      joinWindowSec: 600,
      marksCorrect: 4,
      marksWrong: -1,
      seatCap: 120,
      rrule: "FREQ=WEEKLY;BYDAY=TU;BYHOUR=18;BYMINUTE=0",
    });
    await waitFor(() => expect(templates).toHaveBeenCalledTimes(2));
  });

  it("creates a template leaving the optional group-kind timing field blank", async () => {
    const user = userEvent.setup();
    createTemplate.mockResolvedValue({ ...QUANT_TEMPLATE, id: "new" });
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));

    await user.type(screen.getByLabelText(/name/i), "Weekly Quant");
    await user.selectOptions(screen.getByLabelText(/^section$/i), "quant");
    await user.type(screen.getByLabelText(/question count/i), "2");
    await user.type(screen.getByLabelText(/^easy/i), "2");
    await user.type(screen.getByLabelText(/^medium/i), "0");
    await user.type(screen.getByLabelText(/^hard/i), "0");
    await user.type(screen.getByLabelText(/standalone unit seconds/i), "60");
    await user.type(screen.getByLabelText(/buffer time between units/i), "30");
    await user.type(screen.getByLabelText(/admission window seconds/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(1));
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        timingPolicy: { standalone: 60 },
      }),
    );
  });

  it("rejects a difficulty mix that does not sum to the question count, without calling the API", async () => {
    const user = userEvent.setup();
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));
    await user.type(screen.getByLabelText(/name/i), "Bad Mix");
    await user.selectOptions(screen.getByLabelText(/^section$/i), "quant");
    await user.type(screen.getByLabelText(/question count/i), "2");
    await user.type(screen.getByLabelText(/^easy/i), "1");
    await user.type(screen.getByLabelText(/^medium/i), "0");
    await user.type(screen.getByLabelText(/^hard/i), "0");
    await user.type(screen.getByLabelText(/standalone unit seconds/i), "60");
    await user.type(screen.getByLabelText(/lrdi unit seconds/i), "180");
    await user.type(screen.getByLabelText(/buffer time between units/i), "30");
    await user.type(screen.getByLabelText(/admission window seconds/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    expect(
      await screen.findByText(/must add up to the question count/i),
    ).toBeInTheDocument();
    expect(createTemplate).not.toHaveBeenCalled();
  });

  it("opens the edit form pre-filled with the template's stored values", async () => {
    const user = userEvent.setup();
    templates.mockResolvedValue({
      items: [QUANT_TEMPLATE],
      total: 1,
      limit: 20,
      offset: 0,
    });
    render(<TemplatesPanel />);

    const card = (await screen.findByText("Weekly Quant")).closest("article")!;
    await user.click(within(card).getByRole("button", { name: /edit/i }));

    expect(screen.getByLabelText(/name/i)).toHaveValue("Weekly Quant");
    expect(screen.getByLabelText(/seat cap/i)).toHaveValue(120);
    expect(screen.getByLabelText(/^tue$/i)).toBeChecked();
  });

  it("submits an edit via PATCH with the form's current values", async () => {
    const user = userEvent.setup();
    templates.mockResolvedValue({
      items: [QUANT_TEMPLATE],
      total: 1,
      limit: 20,
      offset: 0,
    });
    updateTemplate.mockResolvedValue({ ...QUANT_TEMPLATE, seatCap: 90 });
    render(<TemplatesPanel />);

    const card = (await screen.findByText("Weekly Quant")).closest("article")!;
    await user.click(within(card).getByRole("button", { name: /edit/i }));

    const seatCap = screen.getByLabelText(/seat cap/i);
    await user.clear(seatCap);
    await user.type(seatCap, "90");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateTemplate).toHaveBeenCalledTimes(1));
    expect(updateTemplate).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ seatCap: 90 }),
    );
  });

  it("deactivates a template after confirming, then reloads the list", async () => {
    const user = userEvent.setup();
    templates.mockResolvedValue({
      items: [QUANT_TEMPLATE],
      total: 1,
      limit: 20,
      offset: 0,
    });
    deactivateTemplate.mockResolvedValue({ ...QUANT_TEMPLATE, active: false });
    render(<TemplatesPanel />);

    const card = (await screen.findByText("Weekly Quant")).closest("article")!;
    await user.click(within(card).getByRole("button", { name: /deactivate/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));

    await waitFor(() => expect(deactivateTemplate).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(templates).toHaveBeenCalledTimes(2));
  });

  it("does not offer a deactivate action for an already-inactive template", async () => {
    templates.mockResolvedValue({
      items: [{ ...QUANT_TEMPLATE, active: false }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    render(<TemplatesPanel />);

    const card = (await screen.findByText("Weekly Quant")).closest("article")!;
    expect(
      within(card).queryByRole("button", { name: /deactivate/i }),
    ).not.toBeInTheDocument();
    expect(within(card).getByText("inactive")).toBeInTheDocument();
  });
});
