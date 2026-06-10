/** How close to the bottom (px) still counts as "at the bottom". */
export const NEAR_BOTTOM_PX = 120;

/**
 * Whether a scroll container is within `threshold` px of its bottom. Drives
 * both auto-stick-to-bottom and the scroll-to-bottom button, so the two can
 * never disagree.
 */
export function isNearBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = NEAR_BOTTOM_PX
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}
