export interface ServerHandle {
  port: number;
  close(): Promise<void>;
}

type BunServer = {
  port: number;
  stop(closeActive?: boolean): void;
};

type BunRuntime = {
  serve(options: {
    port: number;
    idleTimeout: number;
    fetch: (request: Request) => Promise<Response>;
  }): BunServer;
};

export async function startServer(options: {
  port: number;
  fetch: (request: Request) => Promise<Response>;
}): Promise<ServerHandle> {
  const bun = (globalThis as { Bun?: BunRuntime }).Bun;
  if (!bun?.serve) {
    throw new Error("后端必须在 Bun 运行时中启动，请确认已安装或打包 Bun binary");
  }

  const server = bun.serve({
    port: options.port,
    // Bun's default idleTimeout (10s) kills quiet SSE streams — e.g. a run
    // waiting on tool approval. Max allowed is 255 seconds; the SSE
    // keep-alive heartbeat keeps streams below it anyway.
    idleTimeout: 255,
    fetch: options.fetch
  });
  return {
    port: server.port,
    close: async () => server.stop(true)
  };
}
