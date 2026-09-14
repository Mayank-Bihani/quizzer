import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateSummary } from "../../../../src/core/api";
import { TemplatesPanel } from "./TemplatesPanel";

const { templates, createTemplate, updateTemplate, deactivateTemplate, topics } =
  vi.hoisted(() => ({
    templates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deactivateTemplate: vi.fn(),
    topics: vi.fn(),
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
  api: { templates, createTemplate, updateTemplate, deactivateTemplate, topics },
}));

const QUANT_TEMPLATE: TemplateSummary = {
  id: "t1",
  name: "Weekly Quant",
  type: "quant",
  setCount: null,
  standaloneCount: 2,
  difficultyMix: { easy: 2 },
  topics: [],
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
  topics.mockReset();
  templates.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  topics.mockResolvedValue({ topics: ["Arithmetic", "Algebra"] });
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
    await user.selectOptions(screen.getByLabelText(/^section/i), "quant");
    await user.type(screen.getByLabelText(/question count/i), "2");
    await user.type(screen.getByLabelText(/^easy/i), "2");
    await user.type(screen.getByLabelText(/^medium/i), "0");
    await user.type(screen.getByLabelText(/^hard/i), "0");
    await user.type(screen.getByLabelText(/time limit per question/i), "60");
    await user.type(screen.getByLabelText(/time limit per lrdi/i), "180");
    await user.type(screen.getByLabelText(/buffer between/i), "30");
    await user.type(screen.getByLabelText(/admission window/i), "600");
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
      setCount: null,
      standaloneCount: 2,
      difficultyMix: { easy: 2, medium: 0, hard: 0 },
      topics: [],
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
    await user.selectOptions(screen.getByLabelText(/^section/i), "quant");
    await user.type(screen.getByLabelText(/question count/i), "2");
    await user.type(screen.getByLabelText(/^easy/i), "2");
    await user.type(screen.getByLabelText(/^medium/i), "0");
    await user.type(screen.getByLabelText(/^hard/i), "0");
    await user.type(screen.getByLabelText(/time limit per question/i), "60");
    await user.type(screen.getByLabelText(/buffer between/i), "30");
    await user.type(screen.getByLabelText(/admission window/i), "600");
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

  it("rejects a difficulty mix that adds up to more than the question count, without calling the API", async () => {
    const user = userEvent.setup();
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));
    await user.type(screen.getByLabelText(/name/i), "Bad Mix");
    await user.selectOptions(screen.getByLabelText(/^section/i), "quant");
    await user.type(screen.getByLabelText(/question count/i), "2");
    await user.type(screen.getByLabelText(/^easy/i), "5");
    await user.type(screen.getByLabelText(/time limit per question/i), "60");
    await user.type(screen.getByLabelText(/time limit per lrdi/i), "180");
    await user.type(screen.getByLabelText(/buffer between/i), "30");
    await user.type(screen.getByLabelText(/admission window/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    expect(
      await screen.findByText(/can't add up to more than the question count/i),
    ).toBeInTheDocument();
    expect(createTemplate).not.toHaveBeenCalled();
  });

  it("leaves unspecified difficulties out of the mix so they draw from any difficulty", async () => {
    const user = userEvent.setup();
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));
    await user.type(screen.getByLabelText(/name/i), "Partial Mix");
    await user.selectOptions(screen.getByLabelText(/^section/i), "quant");
    await user.type(screen.getByLabelText(/question count/i), "2");
    await user.type(screen.getByLabelText(/^easy/i), "1");
    // medium and hard are left blank on purpose — the remaining slot should draw from any difficulty.
    await user.type(screen.getByLabelText(/time limit per question/i), "60");
    await user.type(screen.getByLabelText(/time limit per lrdi/i), "180");
    await user.type(screen.getByLabelText(/buffer between/i), "30");
    await user.type(screen.getByLabelText(/admission window/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(1));
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ difficultyMix: { easy: 1 } }),
    );
  });

  it("creates an lr template as a whole-set count, never a question count", async () => {
    const user = userEvent.setup();
    createTemplate.mockResolvedValue({ ...QUANT_TEMPLATE, id: "new", type: "lr" });
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));
    await user.type(screen.getByLabelText(/name/i), "Weekly LRDI");
    await user.selectOptions(screen.getByLabelText(/^section/i), "lr");

    // Only a single "number of sets" field is offered for lr — no standalone/difficulty fields,
    // since a set's members keep whatever difficulty they were authored with.
    expect(screen.getByLabelText(/number of lrdi sets/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^easy/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/number of lrdi sets/i), "1");
    await user.type(screen.getByLabelText(/time limit per question/i), "60");
    await user.type(screen.getByLabelText(/time limit per lrdi/i), "180");
    await user.type(screen.getByLabelText(/buffer between/i), "30");
    await user.type(screen.getByLabelText(/admission window/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(1));
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "lr", setCount: 1, standaloneCount: null, difficultyMix: {} }),
    );
  });

  it("creates a verbal template with independent RC-passage and VA-question counts", async () => {
    const user = userEvent.setup();
    createTemplate.mockResolvedValue({ ...QUANT_TEMPLATE, id: "new", type: "verbal" });
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));
    await user.type(screen.getByLabelText(/name/i), "Weekly VARC");
    await user.selectOptions(screen.getByLabelText(/^section/i), "verbal");

    // "1" RC passage must never be satisfiable by a standalone VA question — the two counts are
    // independent fields, not one flat count.
    await user.type(screen.getByLabelText(/rc passages/i), "1");
    await user.type(screen.getByLabelText(/va questions/i), "0");
    await user.type(screen.getByLabelText(/time limit per question/i), "60");
    await user.type(screen.getByLabelText(/time limit per rc/i), "600");
    await user.type(screen.getByLabelText(/buffer between/i), "30");
    await user.type(screen.getByLabelText(/admission window/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(1));
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "verbal", setCount: 1, standaloneCount: 0, difficultyMix: {} }),
    );
  });

  it("FE-1: shows a topics picker only for quant, populated from api.topics", async () => {
    const user = userEvent.setup();
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));
    await user.selectOptions(screen.getByLabelText(/^section/i), "quant");

    expect(await screen.findByLabelText(/topics/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Arithmetic" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Algebra" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^section/i), "lr");
    expect(screen.queryByLabelText(/topics/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^section/i), "verbal");
    expect(screen.queryByLabelText(/topics/i)).not.toBeInTheDocument();
  });

  it("FE-2: submits the selected topics for a quant template", async () => {
    const user = userEvent.setup();
    createTemplate.mockResolvedValue({ ...QUANT_TEMPLATE, id: "new" });
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));
    await user.type(screen.getByLabelText(/name/i), "Weekly Quant");
    await user.selectOptions(screen.getByLabelText(/^section/i), "quant");
    await user.type(screen.getByLabelText(/question count/i), "2");
    await user.type(screen.getByLabelText(/^easy/i), "2");
    await user.type(screen.getByLabelText(/^medium/i), "0");
    await user.type(screen.getByLabelText(/^hard/i), "0");
    await user.selectOptions(await screen.findByLabelText(/topics/i), ["Arithmetic"]);
    await user.type(screen.getByLabelText(/time limit per question/i), "60");
    await user.type(screen.getByLabelText(/time limit per lrdi/i), "180");
    await user.type(screen.getByLabelText(/buffer between/i), "30");
    await user.type(screen.getByLabelText(/admission window/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(1));
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ["Arithmetic"] }),
    );
  });

  it("FE-3: pre-selects the template's stored topics on edit", async () => {
    const user = userEvent.setup();
    templates.mockResolvedValue({
      items: [{ ...QUANT_TEMPLATE, topics: ["Algebra"] }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    render(<TemplatesPanel />);

    const card = (await screen.findByText("Weekly Quant")).closest("article")!;
    await user.click(within(card).getByRole("button", { name: /edit/i }));

    const select = (await screen.findByLabelText(/topics/i)) as HTMLSelectElement;
    const selected = [...select.selectedOptions].map((o) => o.value);
    expect(selected).toEqual(["Algebra"]);
  });

  it("FE-4: describeDraw appends selected topics for a quant template with a non-empty topics list", async () => {
    templates.mockResolvedValue({
      items: [{ ...QUANT_TEMPLATE, topics: ["Arithmetic", "Algebra"] }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    render(<TemplatesPanel />);

    const card = (await screen.findByText("Weekly Quant")).closest("article")!;
    expect(within(card).getByText(/2 questions \(Arithmetic, Algebra\)/)).toBeInTheDocument();
  });

  it("does not append a topics suffix for a quant template with an empty topics list", async () => {
    templates.mockResolvedValue({
      items: [QUANT_TEMPLATE],
      total: 1,
      limit: 20,
      offset: 0,
    });
    render(<TemplatesPanel />);

    const card = (await screen.findByText("Weekly Quant")).closest("article")!;
    expect(within(card).getByText(/^2 questions/)).toBeInTheDocument();
    expect(within(card).queryByText(/\(/)).not.toBeInTheDocument();
  });

  it("rejects a verbal template with both RC passages and VA questions at 0", async () => {
    const user = userEvent.setup();
    render(<TemplatesPanel />);

    await user.click(await screen.findByRole("button", { name: /new template/i }));
    await user.type(screen.getByLabelText(/name/i), "Empty VARC");
    await user.selectOptions(screen.getByLabelText(/^section/i), "verbal");
    await user.type(screen.getByLabelText(/rc passages/i), "0");
    await user.type(screen.getByLabelText(/va questions/i), "0");
    await user.type(screen.getByLabelText(/time limit per question/i), "60");
    await user.type(screen.getByLabelText(/time limit per rc/i), "600");
    await user.type(screen.getByLabelText(/buffer between/i), "30");
    await user.type(screen.getByLabelText(/admission window/i), "600");
    await user.type(screen.getByLabelText(/marks for correct/i), "4");
    await user.type(screen.getByLabelText(/marks for wrong/i), "-1");
    await user.type(screen.getByLabelText(/seat cap/i), "120");
    await user.click(screen.getByLabelText(/^tue$/i));
    await user.type(screen.getByLabelText(/hour \(ist\)/i), "18");
    await user.type(screen.getByLabelText(/minute/i), "0");

    await user.click(screen.getByRole("button", { name: /create template/i }));

    expect(
      await screen.findByText(/set at least one of rc passages or va questions/i),
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
