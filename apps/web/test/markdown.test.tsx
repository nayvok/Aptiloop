import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/ui/markdown";

describe("Markdown", () => {
  it("renders inline code, fenced code blocks and links", () => {
    const { container } = render(
      <Markdown>
        {[
          "Перед кодом напиши `const`.",
          "",
          "```ts",
          "const answer: number = 42;",
          "```",
          "",
          "Подробнее в [документации](https://example.com/docs).",
        ].join("\n")}
      </Markdown>,
    );

    const block = container.querySelector("pre");
    expect(block).not.toBeNull();
    expect(block).toHaveClass("overflow-x-auto");
    expect(container.querySelector("pre code")).toHaveTextContent(
      "const answer: number = 42;",
    );
    const inline = container.querySelector("code:not(pre code)");
    expect(inline).not.toBeNull();
    expect(inline).toHaveTextContent("const");
    expect(inline).toHaveClass("bg-muted");
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
  });

  it("renders GFM tables", () => {
    const { container } = render(
      <Markdown>
        {"| Тема | Статус |\n| --- | --- |\n| Скоуп | Изучено |"}
      </Markdown>,
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("th")).toHaveTextContent("Тема");
    const cells = container.querySelectorAll("td");
    expect(cells).toHaveLength(2);
    expect(cells[0]?.textContent).toBe("Скоуп");
    expect(cells[1]?.textContent).toBe("Изучено");
  });
});
