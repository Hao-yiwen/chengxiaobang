import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

export interface ServerHandle {
  port: number;
  close(): Promise<void>;
}

export async function startServer(options: {
  port: number;
  fetch: (request: Request) => Promise<Response>;
}): Promise<ServerHandle> {
  const bun = (globalThis as { Bun?: { serve: Function } }).Bun;
  if (bun?.serve) {
    const server = bun.serve({
      port: options.port,
      // Bun's default idleTimeout (10s) kills quiet SSE streams — e.g. a run
      // waiting on tool approval. Max allowed is 255 seconds; the SSE
      // keep-alive heartbeat in api/app.ts keeps streams below it anyway.
      idleTimeout: 255,
      fetch: options.fetch
    }) as { port: number; stop(closeActive?: boolean): void };
    return {
      port: server.port,
      close: async () => server.stop(true)
    };
  }

  const server = createServer(async (request, response) => {
    try {
      const webRequest = await toWebRequest(request);
      const webResponse = await options.fetch(webRequest);
      await writeWebResponse(response, webResponse);
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : options.port,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const url = `http://${request.headers.host}${request.url ?? "/"}`;
  return new Request(url, {
    method: request.method,
    headers: request.headers as Record<string, string>,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined
  });
}

async function writeWebResponse(response: ServerResponse, webResponse: Response): Promise<void> {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => response.setHeader(key, value));
  if (!webResponse.body) {
    response.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(webResponse.body as never)
      .on("error", reject)
      .on("end", resolve)
      .pipe(response);
  });
}
