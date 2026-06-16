import { Type, type TSchema } from "@earendil-works/pi-ai";

/**
 * 把 MCP 工具的 inputSchema（JSON Schema）透传为 pi 的 parameters(TSchema)。
 * 用 Type.Unsafe 原样包裹：typebox 1.x 没有稳定的官方 JSON Schema importer，自写完整翻译易漏
 * $ref/oneOf/allOf 等，得不偿失；MCP server 自己才是 schema 的权威，由它做参数校验。
 * 这里只做防御性规整，确保最终是一个带 properties 的 object schema，避免 provider 不识别。
 */
export function toToolParameters(inputSchema: unknown): TSchema {
  return Type.Unsafe<Record<string, unknown>>(normalizeJsonSchema(inputSchema));
}

/** 规整为 `{ type: "object", properties: {...}, ... }`：MCP inputSchema 规范上总是 object。 */
function normalizeJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const record = { ...(schema as Record<string, unknown>) };
  if (record.type !== "object") {
    record.type = "object";
  }
  if (!record.properties || typeof record.properties !== "object") {
    record.properties = {};
  }
  return record;
}
