import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("portals a viewport overlay outside the bounded app container", () => {
    const host = document.createElement("div");
    document.body.append(host);
    render(
      <ConfirmDialog
        open
        title="Cancel quiz?"
        confirmLabel="Cancel quiz"
        onConfirm={() => {}}
        onClose={() => {}}
      >
        This cannot be undone.
      </ConfirmDialog>,
      { container: host },
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body.lastElementChild);
  });
});
