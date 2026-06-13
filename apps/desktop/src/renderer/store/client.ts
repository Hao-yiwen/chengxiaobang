import type { ApiClient } from "../lib/api";

export const apiClientRef: { current?: ApiClient } = {};
let unsubscribeRunEvents: (() => void) | undefined;

export function getApiClient(): ApiClient | undefined {
  return apiClientRef.current;
}

export function setApiClient(client: ApiClient): void {
  apiClientRef.current = client;
}

export function replaceRunEventSubscription(next?: () => void): void {
  unsubscribeRunEvents?.();
  unsubscribeRunEvents = next;
}

export function clearApiClient(): void {
  replaceRunEventSubscription(undefined);
  apiClientRef.current = undefined;
}
