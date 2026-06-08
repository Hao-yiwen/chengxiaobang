export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: withCors({
      "Content-Type": "application/json; charset=utf-8"
    })
  });
}

export function errorResponse(error: unknown, status = 500): Response {
  return jsonResponse(
    { error: error instanceof Error ? error.message : String(error) },
    status
  );
}

export function emptyResponse(status = 204): Response {
  return new Response(null, {
    status,
    headers: withCors({})
  });
}

export function withCors(headers: Record<string, string>): Headers {
  return new Headers({
    ...headers,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-chengxiaobang-token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  });
}
