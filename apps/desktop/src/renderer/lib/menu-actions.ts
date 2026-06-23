export function runAfterMenuClose(action: () => void | Promise<void>): void {
  window.setTimeout(() => void action(), 0);
}
