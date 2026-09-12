import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MathText } from "./MathText";

describe("MathText", () => {
  it("renders inline and display LaTeX through KaTeX", () => {
    const { container } = render(
      <MathText text={"Solve $x^2$ then $$x=2$$."} />,
    );

    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.textContent).toContain("Solve");
  });

  it("renders malformed math as text instead of injecting markup", () => {
    const { container } = render(
      <MathText text={"Question $<img src=x onerror=alert(1)>$"} />,
    );

    expect(container.querySelector("img")).toBeNull();
  });
});
