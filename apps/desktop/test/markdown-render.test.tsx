// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Markdown } from "../src/renderer/components/Markdown";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

describe("Markdown", () => {
  it("renders safe http links as external anchors", () => {
    render(<Markdown text="see [docs](https://example.com) here" />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("does not linkify unsafe protocols, keeping the text visible", () => {
    render(<Markdown text="[x](javascript:alert)" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("copies a code block to the clipboard and shows a copied state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });

    render(<Markdown text={"```ts\nconst x = 1;\n```"} />);
    fireEvent.click(screen.getByText("复制"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1;"));
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });
});
