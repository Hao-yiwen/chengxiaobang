import type { UsageCostSource } from "../repository/state-store";

export interface UsageCostErrorInput {
  stopReason: "error" | "aborted";
  errorMessage?: string;
  statusCode?: number;
  signalAborted?: boolean;
  receivedResponse?: boolean;
}

export interface UsageCostErrorClassification {
  billable: boolean;
  costSource: UsageCostSource;
  reasonCode: string;
  statusCode?: number;
}

const NON_BILLABLE_STATUS_CODES = new Set([401, 403, 429, 502, 503, 504]);

const NETWORK_ERROR_PATTERNS = [
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /\bETIMEDOUT\b/i,
  /\bTLS\b/i,
  /fetch failed/i,
  /network error/i,
  /socket hang up/i,
  /连接失败/i,
  /网络.*失败/i
];

const CONTEXT_LIMIT_PATTERNS = [
  /context[_\s-]?length/i,
  /maximum context/i,
  /token limit/i,
  /max tokens/i,
  /too many tokens/i,
  /上下文.*(超|过|满)/i,
  /token.*(超限|过长)/i
];

export function classifyUsageCostError(
  input: UsageCostErrorInput
): UsageCostErrorClassification {
  const statusCode = input.statusCode ?? parseStatusCode(input.errorMessage);
  const errorMessage = input.errorMessage ?? "";

  if (statusCode !== undefined && NON_BILLABLE_STATUS_CODES.has(statusCode)) {
    return {
      billable: false,
      costSource: "non_billable_error",
      reasonCode: `http_${statusCode}`,
      statusCode
    };
  }

  if (NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage))) {
    return {
      billable: false,
      costSource: "non_billable_error",
      reasonCode: "network_error",
      ...(statusCode !== undefined ? { statusCode } : {})
    };
  }

  if (CONTEXT_LIMIT_PATTERNS.some((pattern) => pattern.test(errorMessage))) {
    return {
      billable: true,
      costSource: "input_estimate_error",
      reasonCode: "context_limit",
      ...(statusCode !== undefined ? { statusCode } : {})
    };
  }

  if (input.stopReason === "aborted" || input.signalAborted) {
    return {
      billable: true,
      costSource: "input_estimate_error",
      reasonCode: "user_aborted",
      ...(statusCode !== undefined ? { statusCode } : {})
    };
  }

  if (!input.receivedResponse) {
    return {
      billable: false,
      costSource: "non_billable_error",
      reasonCode: "request_not_sent",
      ...(statusCode !== undefined ? { statusCode } : {})
    };
  }

  return {
    billable: true,
    costSource: "input_estimate_error",
    reasonCode: input.receivedResponse ? "upstream_error" : "unknown_error",
    ...(statusCode !== undefined ? { statusCode } : {})
  };
}

export function parseStatusCode(message: string | undefined): number | undefined {
  if (!message) {
    return undefined;
  }
  const match =
    message.match(/\b(?:HTTP|status|连接失败)\s*:?\s*(\d{3})\b/i) ??
    message.match(/\b(4\d{2}|5\d{2})\b/);
  if (!match?.[1]) {
    return undefined;
  }
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : undefined;
}
