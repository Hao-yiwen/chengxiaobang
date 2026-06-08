import * as piAi from "@earendil-works/pi-ai";
import * as piAgentCore from "@earendil-works/pi-agent-core";

export interface PiRuntimeStatus {
  available: boolean;
  ai?: unknown;
  agentCore?: unknown;
  error?: string;
}

export async function loadPiRuntime(): Promise<PiRuntimeStatus> {
  try {
    return { available: true, ai: piAi, agentCore: piAgentCore };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
