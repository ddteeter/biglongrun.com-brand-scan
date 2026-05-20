import { describe, test, expect } from "bun:test";
import { renderMarkdown } from "../../../src/domain/assessments/markdown";

describe("renderMarkdown", () => {
  test("renders basic markdown to HTML", () => {
    const html = renderMarkdown("# Hello\n\nSome **bold** text.");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("strips dangerous tags", () => {
    const html = renderMarkdown("<script>alert(1)</script>\n\nSafe text.");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Safe text.");
  });

  test("strips javascript: URLs in links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  test("allows safe inline formatting (em, strong, code, links)", () => {
    const html = renderMarkdown("**bold** *em* `code` [link](https://example.com)");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com"');
  });

  test("empty input returns empty string", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
