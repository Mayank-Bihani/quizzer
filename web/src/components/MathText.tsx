import katex from "katex";
import { Fragment, type ReactNode } from "react";

const MATH_PATTERN = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;

function renderMath(source: string, displayMode: boolean): ReactNode {
  const expression = displayMode ? source.slice(2, -2) : source.slice(1, -1);
  try {
    const html = katex.renderToString(expression, {
      displayMode,
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: true,
      trust: false,
    });
    return (
      <span
        className={displayMode ? "mathblock" : "math"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return source;
  }
}

export function MathText({ text }: { text: string }) {
  return (
    <>
      {text.split(MATH_PATTERN).map((part, index) => {
        const isDisplay = part.startsWith("$$") && part.endsWith("$$");
        const isInline =
          !isDisplay && part.startsWith("$") && part.endsWith("$");
        return (
          <Fragment key={`${index}:${part}`}>
            {isDisplay || isInline ? renderMath(part, isDisplay) : part}
          </Fragment>
        );
      })}
    </>
  );
}
