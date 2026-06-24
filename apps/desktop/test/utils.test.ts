import { describe, expect, it } from "vitest";
import { cn } from "../src/renderer/lib/utils";

describe("cn", () => {
  it("keeps design font-size tokens when combined with text colors", () => {
    expect(cn("text-display-xl text-foreground")).toContain("text-display-xl");
    expect(cn("text-display-lg text-foreground")).toContain("text-display-lg");
    expect(cn("text-display-xl text-foreground")).toContain("text-foreground");
  });
});
