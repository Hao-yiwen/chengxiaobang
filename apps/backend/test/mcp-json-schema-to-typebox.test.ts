import { describe, expect, it } from "vitest";
import { toToolParameters } from "../src/mcp/json-schema-to-typebox";

describe("toToolParameters", () => {
  it("passes a valid object schema through unchanged", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" }, n: { type: "number" } },
      required: ["a"]
    };
    const result = toToolParameters(schema) as Record<string, unknown>;
    expect(result.type).toBe("object");
    expect((result.properties as Record<string, unknown>).a).toEqual({ type: "string" });
    expect(result.required).toEqual(["a"]);
  });

  it("coerces missing / non-object schemas into an empty object schema", () => {
    expect((toToolParameters(undefined) as Record<string, unknown>).type).toBe("object");
    expect((toToolParameters(undefined) as Record<string, unknown>).properties).toEqual({});
    const fromString = toToolParameters({ type: "string" }) as Record<string, unknown>;
    expect(fromString.type).toBe("object");
    const objWithoutProps = toToolParameters({ type: "object" }) as Record<string, unknown>;
    expect(objWithoutProps.properties).toEqual({});
  });
});
