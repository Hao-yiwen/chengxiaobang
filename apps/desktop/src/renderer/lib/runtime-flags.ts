interface RendererRuntimeEnv {
  DEV?: boolean;
  PROD?: boolean;
}

export function shouldShowSessionDebugButton(
  env: RendererRuntimeEnv = import.meta.env
): boolean {
  return env.DEV === true && env.PROD !== true;
}
